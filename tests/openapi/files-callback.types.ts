import { getFileUrl, downloadFile, deleteFile, type GetFileUrlOptions, type DownloadFileOptions, type DeleteFileOptions } from '../../src/files.js';

// Array.map supplies index and array arguments; the public helpers must accept it directly.
declare const urls: GetFileUrlOptions[];
declare const downloads: DownloadFileOptions[];
declare const deletions: DeleteFileOptions[];
urls.map(getFileUrl);
downloads.map(downloadFile);
deletions.map(deleteFile);
