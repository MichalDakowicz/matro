const { parentPort, workerData } = require('node:worker_threads');
const { detectSegments } = require('./segments.cjs');
parentPort.postMessage(detectSegments(workerData.target, workerData.refs));
