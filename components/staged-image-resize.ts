/**
 * Client-side downscale before staging, so every staged image is already
 * within the server's own default resize target and a submission's request
 * body stays bounded. Mirrors src/agent/image-processing/resize-core.mjs
 * (DEFAULT_OPTIONS and its fallback order); the server still resizes for the
 * selected model on admission. The canvas/bitmap codec sits behind
 * `ImageCodec` so the decision logic runs in Node tests.
 */

/** resize-core.mjs DEFAULT_OPTIONS: 2000×2000, 4.5 MiB measured as base64. */
export const IMAGE_TARGET = { maxWidth: 2000, maxHeight: 2000, maxBytes: 4.5 * 1024 * 1024 } as const;
/** Re-encode qualities, highest first (the server steps 80/85/70/55/40). */
export const JPEG_QUALITIES = [0.9, 0.85, 0.7, 0.55, 0.4] as const;

export type EncodedType = "image/png" | "image/jpeg";
export interface DecodedImage {
	readonly width: number;
	readonly height: number;
	/** Draw the (first frame of the) image at this size and encode it. */
	encode(width: number, height: number, type: EncodedType, quality?: number): Promise<Uint8Array>;
	close(): void;
}
export interface ImageCodec {
	decode(bytes: Uint8Array, mimeType: string): Promise<DecodedImage>;
}

export const base64Size = (byteLength: number) => Math.ceil(byteLength / 3) * 4;

/** Fit within the target box keeping the aspect ratio (the server's rounding). */
export function fitWithin(width: number, height: number, max: { maxWidth: number; maxHeight: number } = IMAGE_TARGET): { width: number; height: number } {
	if (width > max.maxWidth) { height = Math.round((height * max.maxWidth) / width); width = max.maxWidth; }
	if (height > max.maxHeight) { width = Math.round((width * max.maxHeight) / height); height = max.maxHeight; }
	return { width: Math.max(1, width), height: Math.max(1, height) };
}

/** The encodings to try at each size: PNG stays PNG when it fits; every
 *  source can fall back to JPEG at descending quality. */
export function encodingOrder(mimeType: string): { type: EncodedType; quality?: number }[] {
	return [...(mimeType === "image/png" ? [{ type: "image/png" as const }] : []), ...JPEG_QUALITIES.map(quality => ({ type: "image/jpeg" as const, quality }))];
}

/**
 * The bytes to stage. Within the target (dimensions and base64 size): the
 * input, byte for byte, animated GIFs included. Over it: scaled into
 * 2000×2000 and re-encoded under 4.5 MiB, shrinking by 3/4 per round like
 * the server; an animated GIF becomes its first frame. Null: no encoding
 * fits, or an image over the byte target cannot be decoded.
 */
export async function fitStagedImage(bytes: Uint8Array, mimeType: string, codec: ImageCodec): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
	const withinBytes = base64Size(bytes.byteLength) < IMAGE_TARGET.maxBytes;
	let image: DecodedImage;
	try { image = await codec.decode(bytes, mimeType); }
	// No decoder here (or an undecodable file): small bytes go to the server
	// unchanged and it decides; large ones cannot be made to fit.
	catch { return withinBytes ? { bytes, mimeType } : null; }
	try {
		if (withinBytes && image.width <= IMAGE_TARGET.maxWidth && image.height <= IMAGE_TARGET.maxHeight) return { bytes, mimeType };
		let { width, height } = fitWithin(image.width, image.height);
		const order = encodingOrder(mimeType);
		for (;;) {
			for (const { type, quality } of order) {
				const encoded = await image.encode(width, height, type, quality);
				if (base64Size(encoded.byteLength) < IMAGE_TARGET.maxBytes) return { bytes: encoded, mimeType: type };
			}
			const next = { width: Math.max(1, Math.floor(width * 0.75)), height: Math.max(1, Math.floor(height * 0.75)) };
			if (next.width === width && next.height === height) return null;
			({ width, height } = next);
		}
	} catch {
		return null;
	} finally {
		image.close();
	}
}

/** createImageBitmap + canvas. Unavailable (SSR, Node): decode rejects. */
export const browserImageCodec: ImageCodec = {
	async decode(bytes, mimeType) {
		if (typeof createImageBitmap !== "function") throw new Error("No image decoder");
		const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }));
		return {
			width: bitmap.width,
			height: bitmap.height,
			close: () => bitmap.close(),
			async encode(width, height, type, quality) {
				const offscreen = typeof OffscreenCanvas !== "undefined";
				const canvas = offscreen ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
				const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
				if (!context) throw new Error("No canvas context");
				// JPEG has no alpha: flatten onto white rather than black.
				if (type === "image/jpeg") { context.fillStyle = "#fff"; context.fillRect(0, 0, width, height); }
				context.imageSmoothingQuality = "high";
				context.drawImage(bitmap, 0, 0, width, height);
				const blob = canvas instanceof HTMLCanvasElement
					? await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("Encoding failed")), type, quality))
					: await (canvas as OffscreenCanvas).convertToBlob({ type, quality });
				return new Uint8Array(await blob.arrayBuffer());
			},
		};
	},
};
