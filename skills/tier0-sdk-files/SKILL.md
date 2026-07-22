---
name: tier0-sdk-files
version: 1.0.0
description: "Tier0 SDK managed file and attachment operations for TypeScript/JavaScript. Use when an app must upload and persist a file, store its reference in business data, obtain a public/private access URL, download content, or delete a managed file through @tier0/sdk/files. Prefer this Skill over direct S3/RustFS clients."
metadata:
  requires:
    npm: ["@tier0/sdk"]
---

# Tier0 SDK — Files

**Before starting, read [`../tier0-sdk/SKILL.md`](../tier0-sdk/SKILL.md).**

## Required Flow

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
2. Business records store `filePath`.
3. Presigned URLs and permanent storage credentials are not persisted.
