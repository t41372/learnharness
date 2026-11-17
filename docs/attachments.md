# Pasted images

Learner files use upstream's two channels: the desktop paperclip and drag-and-drop insert file-path chips, and images travel as native inline image blocks. This fork adds only pasted images on top.

## Behaviour

- Paste an image (a screenshot, or image data copied from another app) into any built-in input: home and new sessions, the conversation composer (including a steer while a turn runs), a question's answer or thinking field, the reading-thinking field beside a waiting check, and Practice thinking. The image appears as a thumbnail above the text with a remove button. Text in the same clipboard is pasted as usual.
- In an ordinary browser, which has no local file paths, dropped or picked image files are staged the same way, and the paperclip opens an image picker. Other files without a path, such as PDFs or text files, show the existing notice that local file paths need the desktop app.
- In the desktop app the paperclip and drag-and-drop are unchanged: every file, images included, becomes a path chip.
- Each input holds up to 10 images, in PNG, JPEG, GIF or WebP, from files of up to 20 MB. An image that breaks a limit stays in the strip with the reason and is not sent.
- Before staging, the browser shrinks any image beyond the server's default resize target (`resize-core.mjs`: 2000×2000, 4.5 MiB measured as base64). It scales the image to fit 2000×2000 and re-encodes it: a PNG stays PNG if that fits, otherwise JPEG at quality 0.9, 0.85, 0.7, 0.55 and then 0.4, shrinking by a quarter per round like the server. An animated GIF over the target becomes a still frame. Images already within the target are kept byte for byte, and only the result is stored.
- One send stays under the request body cap (`proxyClientMaxBodySize` in `next.config.ts`, from `MAX_IMPORT_BODY_BYTES`) with 1 MiB to spare. A question's answer, thinking and reading-thinking images share one budget; the composer and Practice thinking each have their own. An image that would exceed it is refused in the strip, and the others are kept.
- Sending puts the images in the submission's upstream channel: the message content for text and steers, `images.answer` for a text answer, `images.thinking` for a question's thinking, `images.readingThinking` for reading thinking, and the Practice thinking marker's images. The server prepares them as before: it resizes them for the model, and a model without image input refuses with "does not support images. Your input has been kept."
- Images that have not been sent are kept in the browser's IndexedDB, one draft per chat (or new session), input and question or problem. They come back after a reload or an app restart. They are cleared when the server accepts the submission or when you remove them, and kept when a submission is refused. Images pasted on the home screen or a new session move to the created session and are sent with its opening message.

`components/staged-images.ts` holds the drafts, limits, budget and storage; `components/staged-image-resize.ts` downscales through a replaceable canvas codec; `components/staged-image-strip.tsx` is the strip and the paste handler. Sent images render with upstream's existing transcript and answer-card components.

## Migrating old data

The retired attachment store saved references in chat records and bytes under `data/attachments/`. Convert them once:

```sh
node --import tsx scripts/migrate-attachments-to-inline-images.mjs --data <data dir>            # dry run
node --import tsx scripts/migrate-attachments-to-inline-images.mjs --data <data dir> --apply --backup <existing dir>
```

Images become inline image blocks. PDF and text references become path chips pointing at the kept files: in a text message, an answer's text (or its thinking for a choice question), or the Practice thinking text. Changed chat files are copied to `<backup>/chats/` first. A second run changes nothing, and `data/attachments/` is left in place.
