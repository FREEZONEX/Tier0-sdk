---
name: tier0-sdk-files
version: 1.1.0
description: "Tier0 SDK managed file and attachment operations for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use whenever a user needs an upload, attachment, avatar, import, persisted file, large-file or multipart upload, progress, resume, access URL, download, or deletion feature. Always use uploadFile as the upload entry point: the SDK automatically switches files larger than 100 MB to multipart upload, and application code must not bypass that routing. Default to @tier0/sdk/files managed S3/RustFS storage instead of local application storage, database blobs, direct object-storage clients, or app-authored multipart logic."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — Files

**Before starting, read the root SDK Skill at [`../SKILL.md`](../SKILL.md).**

## Required Flow

When a user asks for an upload-and-save feature, use platform-managed object storage through `@tier0/sdk/files` by default. Do not persist uploaded files on the app server's local filesystem, in the repository or `public/` directory, or as database blobs. Local temporary files are allowed only for short-lived processing before upload and must not become the source of truth.

1. Always call `uploadFile` from `@tier0/sdk/files`. Do not implement file slicing or call multipart endpoints from application code.
2. Persist the returned `filePath` in business data; do not persist an expiring presigned URL.
3. Use `getFileUrl` for access/display or `downloadFile` for content/download.
4. Use `deleteFile` when the managed object must be removed.

## Upload Selection

| File or product requirement | Application behavior | SDK behavior |
|---|---|---|
| File size ≤ 100 MB | Call `uploadFile(file, options)` | Use the standard upload path |
| File size > 100 MB | Call the same `uploadFile(file, options)` | Automatically switch to multipart upload; this routing cannot be disabled |
| Progress, concurrency control, or resumable upload at any size | Pass `options.multipart` | Use multipart upload with the requested controls |

The 100 MB threshold selects the transfer method; it is not the product's single-file limit. The backend separately enforces the current plan's file-size limit and storage quota.

## Responsibility Boundary

| Component | Responsibility |
|---|---|
| SDK | Select the upload method, slice files, upload parts concurrently, retry failures, collect ETags, complete or abort the upload, and expose progress/resume APIs |
| Application | Provide file selection and UI; optionally persist `multipartSession` when cross-session resume is required |
| Backend | Authorize requests, issue upload URLs, enforce file-size and storage quotas, and complete or abort multipart sessions |

Do not add AWS SDK/RustFS clients, direct bucket endpoints, permanent object-storage credentials, or application-authored multipart orchestration.

## References

| Task | Read |
|---|---|
| Upload and save a file | [`references/upload.md`](references/upload.md) |
| Configure multipart progress, concurrency, or resume | [`references/multipart.md`](references/multipart.md) |
| Get access URL | [`references/url.md`](references/url.md) |
| Download | [`references/download.md`](references/download.md) |
| Delete | [`references/delete.md`](references/delete.md) |

## Final Checklist

1. File operations use `@tier0/sdk/files`.
2. Persistent uploads are not stored on the app server's local filesystem, in `public/`, or as database blobs.
3. Business records store `filePath`.
4. Presigned URLs and permanent storage credentials are not persisted.
5. Application code calls `uploadFile`; it does not manually split files or call multipart endpoints.
