# AList Node.js SDK

A production-ready, zero-dependency ES6 module designed to interact with the AList V3 REST API. This SDK leverages your permanent Global Admin Token to bypass dynamic session handshakes, auth lifecycles, and JWT expirations, turning your AList instance into a lightweight, headless asset CDN.

It is engineered for high-performance file operations, making it optimal for syncing dynamic storefront assets on platforms like tmrcafe.com or managing rapid file pipelines for automated Discord bots like Infinity Bot.

---

## Features

* **Zero Dependencies:** Built entirely using modern native Node.js global APIs (`fetch`, Streams).
* **Headless Architecture:** Interacts purely with the background data layer, rendering front-end UI blocks completely irrelevant.
* **Persistent Authentication:** Uses a static token—no token refresh logic or login calls required.
* **Stream-Based Uploads:** Low memory footprint when streaming files from local disk straight to remote storage.
* **VFS Mapping:** Abstracted file routes allow you to use clean URLs without exposing underlying cloud folder structures.

---

## Prerequisites

* **Node.js:** version 18.0.0 or higher (required for native `fetch` support with stream duplexing).
* **AList Version:** AList V3.x configured with an active storage provider (e.g., Google Drive).
* **Static API Token:** Generated from your AList dashboard under **Settings > Other**.

---

## Setup & Configuration

### 1. File Placement

Save the `alist-sdk.js` file directly inside your project codebase (e.g., in a `utils/` or `lib/` directory).

### 2. Environment Variables

Add your credentials to your project's root `.env` file. Do not commit your token directly to version control.

```env
ALIST_URL="https://storage.hgphnm.com"
ALIST_TOKEN="alist-1b575861-f116-47dd-aabf-71718a6bfc9fhsTFW5Q4rLNt7vdS2O8H2UI6dXtohwtwFa0TQk6RoueORjzpXWVNTDtwGrWbyLYh"

```

---

## Quick Start Example

Here is how to initialize the client and perform a standard asset upload within your backend logic:

```javascript
import { AListClient } from './utils/alist-sdk.js';
import dotenv from 'dotenv';
dotenv.config();

// Initialize the client globally
const storage = new AListClient(process.env.ALIST_URL, process.env.ALIST_TOKEN);

async function runAssetPipeline() {
    try {
        console.log('🚀 Initializing CDN upload pipeline...');

        // Upload a local image file to your mounted storage path
        const cdnUrl = await storage.upload('./local-assets/matcha-cloud.png', '/public/assets/drinks');
        
        console.log('✅ Upload Successful!');
        console.log(`🔗 Direct CDN Link: ${cdnUrl}`);
        
        // Expected URL Output:
        // https://storage.hgphnm.com/d/public/assets/drinks/matcha-cloud.png

    } catch (error) {
        console.error('❌ Pipeline execution failed:', error.message);
    }
}

runAssetPipeline();

```

---

## Full API Reference

### `new AListClient(baseURL, token)`

Instantiates a stateful interface connected to your storage hub.

| Parameter | Type | Description |
| --- | --- | --- |
| `baseURL` | `string` | The fully qualified domain of your AList instance (e.g., `[https://storage.hgphnm.com](https://storage.hgphnm.com)`). Trailing slashes are automatically handled. |
| `token` | `string` | Your permanent global token pulled from the administrative panel. |

---

### `async upload(localFilePath, remoteDirectory)`

Reads a local file as a readable stream and pipes it directly through the AList object-storage route.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `localFilePath` | `string` | *Required* | Absolute or relative filesystem path to the local source file. |
| `remoteDirectory` | `string` | `/public` | The target directory path inside your AList Virtual File System. |

* **Returns:** `Promise<string>` - The absolute direct streaming URL for HTML embeds (`/d/` path routing).
* **Throws:** An error containing the server error code or message if the filesystem stream or HTTP transaction is disrupted.

---

### `async listFiles(remoteDirectory)`

Queries a specific remote folder route and compiles structural information about its child contents.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `remoteDirectory` | `string` | `/public` | The virtual path directory you want to scan. |

* **Returns:** `Promise<Array<Object>>` - An array of file descriptor objects.
* **Item Schema Example:**
```javascript
{
  name: "matcha-cloud.png",
  size: 204850,
  is_dir: false,
  modified: "2026-07-10T15:22:11Z",
  sign: "" // Empty if 'Enable sign' is turned off in your AList storage configuration
}

```



---

### `async getFileData(remoteFilePath)`

Retrieves metadata for a singular explicit file item without downloading or evaluating the binary payload.

| Parameter | Type | Description |
| --- | --- | --- |
| `remoteFilePath` | `string` | The complete virtual path to the objective file (e.g., `/public/assets/drinks/matcha-cloud.png`). |

* **Returns:** `Promise<Object>` - Comprehensive object payload detailing structural properties, exact sizing, Unix timestamps, and the raw underlying cloud provider details.

---

## Advanced Implementations

### Batch Upload Processing

When processing mass inventory tables, resolve execution payloads using parallel batch techniques:

```javascript
async function batchUploadImages(imageFileList) {
    const storage = new AListClient(process.env.ALIST_URL, process.env.ALIST_TOKEN);
    
    // Process paths concurrently
    const uploadPromises = imageFileList.map(file => {
        return storage.upload(file.localPath, '/public/products')
            .then(url => ({ name: file.name, url, status: 'success' }))
            .catch(err => ({ name: file.name, error: err.message, status: 'failed' }));
    });

    const results = await Promise.all(uploadPromises);
    console.log('Batch sync operations summary:', results);
    return results;
}

```

### Direct HTML Embed Optimization

Because this workflow relies on turning your setup into a headless asset server, ensure that your underlying AList Storage configuration has **Enable sign** turned **OFF**.

This allows you to drop the strings generated by `storage.upload()` straight into frontend contexts safely:

```html
<!-- Fully decoupled from the storage platform UI -->
<img src="https://storage.hgphnm.com/d/public/assets/drinks/matcha-cloud.png" alt="Product Display">

```

---

## Troubleshooting

### `Error: Upload Failed: ...`

* **Cause:** Typically happens if the directory path targeted does not exist, or permissions inside AList have been modified.
* **Fix:** Verify that your target path parameter perfectly mirrors the **Mount Path** name specified inside your AList Storage Admin settings.

### `Fetch Error / Duplex Failures`

* **Cause:** Occurs if running node environments older than v18.
* **Fix:** Ensure you are executing scripts with `node -v` indicating a runtime modern enough to support the global native web fetch standard.