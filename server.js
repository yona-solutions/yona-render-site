const express = require('express');
const { Storage } = require('@google-cloud/storage');
const app = express();

// Render provides the PORT environment variable
const PORT = process.env.PORT || 3000;

// Initialize GCP Storage
let storage;
try {
  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    const serviceAccountKey = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
    storage = new Storage({
      credentials: serviceAccountKey,
      projectId: serviceAccountKey.project_id
    });
    console.log('✅ GCP Storage initialized successfully');
  } else {
    console.warn('⚠️  GCP_SERVICE_ACCOUNT_KEY not found');
  }
} catch (error) {
  console.error('❌ Failed to initialize GCP Storage:', error.message);
}

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Yona Render Site</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 10px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        h1 {
          color: #667eea;
          margin-top: 0;
        }
        .status {
          background: #10b981;
          color: white;
          padding: 10px 20px;
          border-radius: 5px;
          display: inline-block;
          margin: 20px 0;
        }
        code {
          background: #f3f4f6;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: monospace;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 Yona Render Site</h1>
        <div class="status">✅ Service is running!</div>
        <p>Welcome to your Node.js web service deployed on Render.</p>
        <h2>Tools:</h2>
        <ul>
          <li><a href="/storage-browser">📁 Cloud Storage Browser</a> - Browse dimension_configurations bucket</li>
        </ul>
        <h2>API Endpoints:</h2>
        <ul>
          <li><code>GET /</code> - This page</li>
          <li><code>GET /api/health</code> - Health check endpoint</li>
          <li><code>GET /api/info</code> - Service information</li>
          <li><code>GET /api/storage/list?prefix=path</code> - List files in bucket</li>
          <li><code>GET /api/storage/download/:filename</code> - Download a file</li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/info', (req, res) => {
  res.json({
    name: 'Yona Render Site',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    node_version: process.version
  });
});

// GCP Storage Browser UI
app.get('/storage-browser', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cloud Storage Browser</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 30px;
          border-radius: 10px;
          margin-bottom: 20px;
        }
        h1 {
          margin: 0 0 10px 0;
        }
        .breadcrumb {
          background: white;
          padding: 15px 20px;
          border-radius: 5px;
          margin-bottom: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .breadcrumb a {
          color: #667eea;
          text-decoration: none;
          margin-right: 5px;
        }
        .breadcrumb a:hover {
          text-decoration: underline;
        }
        .container {
          background: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .file-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .file-item {
          padding: 15px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: background 0.2s;
        }
        .file-item:hover {
          background: #f9fafb;
        }
        .file-item:last-child {
          border-bottom: none;
        }
        .file-info {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
        }
        .file-icon {
          font-size: 24px;
        }
        .file-name {
          font-weight: 500;
          color: #1f2937;
          cursor: pointer;
        }
        .folder-name {
          color: #667eea;
          cursor: pointer;
        }
        .file-size {
          color: #6b7280;
          font-size: 14px;
        }
        .download-btn {
          background: #667eea;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 14px;
          transition: background 0.2s;
        }
        .download-btn:hover {
          background: #5568d3;
        }
        .loading {
          text-align: center;
          padding: 40px;
          color: #6b7280;
        }
        .error {
          background: #fee;
          color: #c00;
          padding: 15px;
          border-radius: 5px;
          margin-bottom: 20px;
        }
        .back-link {
          display: inline-block;
          color: white;
          text-decoration: none;
          margin-top: 10px;
          opacity: 0.9;
        }
        .back-link:hover {
          opacity: 1;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📁 Cloud Storage Browser</h1>
        <p>Bucket: dimension_configurations</p>
        <a href="/" class="back-link">← Back to Home</a>
      </div>
      
      <div class="breadcrumb" id="breadcrumb">
        <a href="#" onclick="loadFiles(''); return false;">🏠 Home</a>
      </div>

      <div class="container">
        <div id="error-container"></div>
        <div id="loading" class="loading">Loading files...</div>
        <ul id="file-list" class="file-list" style="display: none;"></ul>
      </div>

      <script>
        let currentPrefix = '';

        function formatBytes(bytes) {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
        }

        function updateBreadcrumb(prefix) {
          const breadcrumb = document.getElementById('breadcrumb');
          let html = '<a href="#" onclick="loadFiles(\\'\\'); return false;">🏠 Home</a>';
          
          if (prefix) {
            const parts = prefix.split('/').filter(p => p);
            let path = '';
            parts.forEach((part, index) => {
              path += part + '/';
              html += \` / <a href="#" onclick="loadFiles('\\${path}'); return false;">\${part}</a>\`;
            });
          }
          
          breadcrumb.innerHTML = html;
        }

        async function loadFiles(prefix = '') {
          currentPrefix = prefix;
          const loading = document.getElementById('loading');
          const fileList = document.getElementById('file-list');
          const errorContainer = document.getElementById('error-container');
          
          loading.style.display = 'block';
          fileList.style.display = 'none';
          errorContainer.innerHTML = '';
          
          updateBreadcrumb(prefix);

          try {
            const response = await fetch(\`/api/storage/list?prefix=\${encodeURIComponent(prefix)}\`);
            const data = await response.json();
            
            if (!response.ok) {
              throw new Error(data.error || 'Failed to load files');
            }

            loading.style.display = 'none';
            fileList.style.display = 'block';
            
            if (data.folders.length === 0 && data.files.length === 0) {
              fileList.innerHTML = '<li class="file-item">No files or folders found</li>';
              return;
            }

            let html = '';
            
            // Display folders first
            data.folders.forEach(folder => {
              html += \`
                <li class="file-item">
                  <div class="file-info">
                    <span class="file-icon">📁</span>
                    <span class="folder-name" onclick="loadFiles('\\${folder}')">\${folder.replace(prefix, '').replace(/\\/$/, '')}</span>
                  </div>
                </li>
              \`;
            });
            
            // Display files
            data.files.forEach(file => {
              const fileName = file.name.replace(prefix, '');
              html += \`
                <li class="file-item">
                  <div class="file-info">
                    <span class="file-icon">📄</span>
                    <div>
                      <div class="file-name">\${fileName}</div>
                      <div class="file-size">\${formatBytes(file.size)} • Updated: \${new Date(file.updated).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <button class="download-btn" onclick="downloadFile('\\${file.name}')">⬇ Download</button>
                </li>
              \`;
            });
            
            fileList.innerHTML = html;
          } catch (error) {
            loading.style.display = 'none';
            errorContainer.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
          }
        }

        async function downloadFile(fileName) {
          try {
            window.location.href = \`/api/storage/download/\${encodeURIComponent(fileName)}\`;
          } catch (error) {
            alert('Failed to download file: ' + error.message);
          }
        }

        // Load root files on page load
        loadFiles('');
      </script>
    </body>
    </html>
  `);
});

// API: List files in the dimension_configurations bucket
app.get('/api/storage/list', async (req, res) => {
  if (!storage) {
    return res.status(500).json({ error: 'GCP Storage not initialized' });
  }

  try {
    const prefix = req.query.prefix || '';
    const bucketName = 'dimension_configurations';
    const bucket = storage.bucket(bucketName);
    
    const [files] = await bucket.getFiles({
      prefix: prefix,
      delimiter: '/'
    });
    
    // Get unique folder prefixes
    const folders = new Set();
    const fileList = [];
    
    files.forEach(file => {
      const relativePath = file.name.substring(prefix.length);
      const parts = relativePath.split('/');
      
      if (parts.length > 1 && parts[0]) {
        // This is a folder
        folders.add(prefix + parts[0] + '/');
      } else if (parts[0]) {
        // This is a file
        fileList.push({
          name: file.name,
          size: parseInt(file.metadata.size),
          updated: file.metadata.updated,
          contentType: file.metadata.contentType
        });
      }
    });
    
    res.json({
      prefix: prefix,
      folders: Array.from(folders).sort(),
      files: fileList.sort((a, b) => a.name.localeCompare(b.name))
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Download a file from the bucket
app.get('/api/storage/download/:filename(*)', async (req, res) => {
  if (!storage) {
    return res.status(500).json({ error: 'GCP Storage not initialized' });
  }

  try {
    const fileName = req.params.filename;
    const bucketName = 'dimension_configurations';
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Get file metadata
    const [metadata] = await file.getMetadata();
    
    // Set headers for download
    res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', \`attachment; filename="\${fileName.split('/').pop()}"\`);
    
    // Stream the file
    file.createReadStream()
      .on('error', (error) => {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: error.message });
      })
      .pipe(res);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server - MUST bind to 0.0.0.0 for Render
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

