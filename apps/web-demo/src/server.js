'use strict';

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Web Demo UI: http://localhost:${PORT}`);
  console.log('API Gateway: http://localhost:3000');
});
