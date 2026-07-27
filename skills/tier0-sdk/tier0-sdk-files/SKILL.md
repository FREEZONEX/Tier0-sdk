---
name: tier0-sdk-files
version: 1.0.0
description: "Tier0 SDK managed file and attachment operations for TypeScript/JavaScript. Before using this Skill, first read tier0-sdk for shared SDK version, configuration, runtime, and layering rules. Use whenever a user needs an upload, attachment, avatar, import, persisted file, access URL, download, or deletion feature. Default to @tier0/sdk/files managed S3/RustFS storage instead of local application storage, database blobs, or direct object-storage clients."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — Files

**Before starting, read the root SDK Skill at [`../SKILL.md`](../SKILL.md).**

## Required Flow

When a user asks for an upload-and-save feature, use platform-managed object storage through `@tier0/sdk/files` by default. Do not persist uploaded files on the app server's local filesystem, in the repository or `public/` directory, or as database blobs. Local temporary files are allowed only for short-lived processing before upload and must not become the source of truth.

1. Use `uploadFile` from `@tier0/sdk/files`.
2. Persist the returned `filePath` in business data; do not persist an expiring presigned URL.
3. Use `getFileUrl` for access/display or `downloadFile` for content/download.
4. Use `deleteFile` when the managed object must be removed.

Do not add AWS SDK/RustFS clients, direct bucket endpoints, or permanent object-storage credentials. The SDK obtains a presigned upload URL and transfers the file to platform-managed storage. Use a manual PUT to the SDK-provided `uploadUrl` only for an advanced requirement such as custom upload progress.

## References

| Task | Read |
|---|---|
| Upload | [`references/upload.md`](references/upload.md) |
| Get access URL | [`references/url.md`](references/url.md) |
| Download | [`references/download.md`](references/download.md) |
| Delete | [`references/delete.md`](references/delete.md) |

## Final Checklist

1. File operations use `@tier0/sdk/files`.
2. Persistent uploads are not stored on the app server's local filesystem, in `public/`, or as database blobs.
3. Business records store `filePath`.
4. Presigned URLs and permanent storage credentials are not persisted.
