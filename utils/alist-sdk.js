const fs   = require('fs');
const path = require('path');

class AListClient {
  /**
   * @param {string} baseURL - Your AList domain (e.g., https://storage.hgphnm.com)
   * @param {string} token   - Static API token from Settings > Other (Settings > Token)
   */
  constructor(baseURL, token) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.token   = token;
  }

  /**
   * Upload a local file to AList.
   * @param {string} localFilePath    - Absolute path to the file on disk
   * @param {string} remoteDirectory  - Target AList folder (defaults to /public)
   * @returns {string} Public CDN download link for the uploaded file
   */
  async upload(localFilePath, remoteDirectory = '/public') {
    const fileName  = path.basename(localFilePath);
    const cleanDir  = remoteDirectory.replace(/\/$/, '');
    const targetPath = encodeURIComponent(`${cleanDir}/${fileName}`);

    const fileStream = fs.createReadStream(localFilePath);

    const response = await fetch(`${this.baseURL}/api/fs/put`, {
      method: 'PUT',
      headers: {
        'Authorization': this.token,
        'File-Path':     targetPath
      },
      body:   fileStream,
      duplex: 'half'
    });

    const data = await response.json();
    if (data.code === 200) {
      return `${this.baseURL}/d${cleanDir}/${fileName}`;
    }
    throw new Error(`AList Upload Failed: ${data.message}`);
  }

  /**
   * List files in a remote AList directory.
   * @param {string} remoteDirectory
   * @returns {Array} Array of file/folder metadata objects
   */
  async listFiles(remoteDirectory = '/public') {
    const response = await fetch(`${this.baseURL}/api/fs/list`, {
      method: 'POST',
      headers: {
        'Authorization': this.token,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ path: remoteDirectory })
    });

    const data = await response.json();
    if (data.code === 200) return data.data.content;
    throw new Error(`AList List Failed: ${data.message}`);
  }

  /**
   * Retrieve metadata for a specific file (includes raw_url for direct download).
   * @param {string} remoteFilePath - Full path to the file on AList
   * @returns {Object} File metadata object including raw_url
   */
  async getFileData(remoteFilePath) {
    const response = await fetch(`${this.baseURL}/api/fs/get`, {
      method: 'POST',
      headers: {
        'Authorization': this.token,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ path: remoteFilePath })
    });

    const data = await response.json();
    if (data.code === 200) return data.data;
    throw new Error(`AList Get File Failed: ${data.message}`);
  }
}

module.exports = { AListClient };