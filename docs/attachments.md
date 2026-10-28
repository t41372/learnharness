# Learner attachments

All learner input surfaces accept pasted files, drag-and-drop, or file selection: home, new sessions, the conversation composer, question answers, and Practice thinking. A message may contain up to ten files of 20 MB each. PNG, JPEG, GIF, WebP, PDF, UTF-8 text, and source-code files are supported. Text and Practice answers can consist solely of attachments; multiple-choice answers still require an answer selection.

`core/attachments.ts` defines immutable references and limits. The adapter in `store/attachments.ts` stores bytes and canonical metadata under `PATHS.data/attachments`, checks file signatures and text encoding, and prevents filenames from determining storage paths. Uploads use one bounded multipart request per file. The existing desktop API capability applies to upload, preview, and download routes.

Native user messages, question results, and Practice markers carry references, never binary payloads. The server replaces client metadata with the stored reference. The conversation's `convertToLlm` callback hydrates images to native image content only after the compaction cut has been applied. Text and PDF manifests give the agent a saved path and direct it to the existing read or PDF tool. Image references count toward context estimates; incompatible conversation models refuse image input before write-ahead persistence.

`components/attachments.tsx` shares upload drafts, file picker, previews, and historical rendering. Upload errors remain retryable; pending or failed uploads gate submission. Composer drafts clear only after the server acknowledges the input. Previews remain inside the trusted window, including on Electron. Initial session navigation carries opaque attachment ids, without binary payloads or filesystem paths in the URL.

Uploaded files remain local in the app's data directory. Attaching them makes them available to the selected AI provider through native image input or the agent's read tools, just as referenced local files are today.
