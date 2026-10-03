const express = require('express');
const path = require('path');
const cliRoutes = require('./routes/cliRoutes');

const app = express();

// Enable CORS for cross-origin API requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// Mount CLI transfer API routes
app.use(cliRoutes);

// Dist directory location
const distPath = path.join(__dirname, '..', 'dist');

// Serve static frontend files with caching headers
app.use(express.static(distPath, {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.includes(path.sep + 'assets' + path.sep)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Fallback for SPA routing
app.get('*', (req, res, next) => {
  if (path.extname(req.path)) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

module.exports = app;
