# Yona Render Site

A modern web application for P&L (Profit & Loss) reporting and GCP Storage management, built with Node.js and deployed on Render.

## 🚀 Features

- **P&L Dashboard**: Interactive profit & loss reporting with hierarchy navigation (District, Region, Subsidiary)
- **Cloud Storage Browser**: Browse and download files from GCP Cloud Storage
- **RESTful API**: Clean API for data access and integrations
- **Responsive Design**: Modern, professional UI that works on all devices
- **Real-time Data**: Live integration with Google Cloud Platform

## 📋 Prerequisites

- Node.js >= 18.0.0
- npm (comes with Node.js)
- GCP Service Account with Storage permissions
- Git

## 🛠️ Local Development

### Quick Start

1. **Clone and Install**
   ```bash
   cd "yona_render_site"
   npm install
   ```

2. **Set Up Environment**
   ```bash
   ./setup-local.sh
   ```
   This creates a `.env` file with your GCP credentials.

3. **Start the Server**
   ```bash
   npm start
   ```
   Visit http://localhost:3000

### Development Commands

```bash
# Start server
npm start

# Restart server (kills port 3000 first)
./restart.sh

# Run with nodemon (auto-restart on changes)
npm run dev
```

See [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for detailed instructions.

## 📁 Project Structure

```
yona_render_site/
├── src/                    # Application source code
│   ├── app.js              # App setup and configuration
│   ├── config/             # Configuration modules
│   ├── routes/             # API and view routes
│   ├── services/           # Business logic
│   ├── middleware/         # Custom middleware
│   └── utils/              # Utility functions
├── public/                 # Static files (HTML, CSS, JS)
├── docs/                   # Documentation
├── server.js               # Application entry point
└── package.json            # Dependencies and scripts
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for detailed architecture documentation.

## 🌐 API Endpoints

### Health & Info
- `GET /api/health` - Server health check
- `GET /api/info` - Application information

### Cloud Storage
- `GET /api/storage/list?prefix=` - List files in bucket
- `GET /api/storage/download/:filename` - Download a file

### P&L Data (Coming Soon)
- `GET /api/pl/data` - Fetch P&L report data

## 🎨 Pages

- **Home** (`/`) - P&L View Dashboard
- **Storage Browser** (`/storage-browser`) - GCP Storage file browser

## 🔐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | No |
| `NODE_ENV` | Environment mode | No |
| `GCP_SERVICE_ACCOUNT_KEY` | GCP credentials (JSON string) | Yes |

## 🚢 Deployment

### Render Deployment

The app automatically deploys to Render when you push to the `main` branch.

**Production URL**: https://yona-render-site.onrender.com

### Configuration

Deployment settings are in `render.yaml`:
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment**: Node.js
- **Plan**: Starter

### Environment Setup on Render

1. Go to Render dashboard
2. Select your service
3. Add environment variable:
   - Key: `GCP_SERVICE_ACCOUNT_KEY`
   - Value: (paste entire JSON service account key)

## 🧪 Testing

```bash
# Health check
curl http://localhost:3000/api/health

# List storage files
curl http://localhost:3000/api/storage/list

# Download a file
curl http://localhost:3000/api/storage/download/account_config.json -O
```

## 📚 Documentation

- [Architecture Guide](./docs/ARCHITECTURE.md) - System design and structure
- [Local Development](./LOCAL_DEVELOPMENT.md) - Dev environment setup
- [API Documentation](./docs/API.md) - API reference (coming soon)

## 🛡️ Security

- GCP credentials stored as environment variables (never committed)
- Service account with minimum required permissions
- CORS configured for API endpoints
- Input validation on all endpoints
- Error messages sanitized for production

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test locally
4. Commit with descriptive messages
5. Push and create a PR

## 📝 License

ISC

## 👥 Team

Yona Solutions

---

## 🆘 Troubleshooting

### Port Already in Use
```bash
lsof -ti:3000 | xargs kill -9
npm start
```

### GCP Authentication Errors
- Check that `.env` file exists and has valid JSON
- Verify GCP_SERVICE_ACCOUNT_KEY environment variable in Render

### Build Failures
- Clear `node_modules`: `rm -rf node_modules && npm install`
- Check Node version: `node --version` (must be >= 18)

## 📞 Support

For issues or questions:
1. Check documentation in `docs/`
2. Review error logs in Render dashboard
3. Contact the development team
