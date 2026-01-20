const express = require('express');
const app = express();

// Render provides the PORT environment variable
const PORT = process.env.PORT || 3000;

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
        <h2>API Endpoints:</h2>
        <ul>
          <li><code>GET /</code> - This page</li>
          <li><code>GET /api/health</code> - Health check endpoint</li>
          <li><code>GET /api/info</code> - Service information</li>
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

// Start server - MUST bind to 0.0.0.0 for Render
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

