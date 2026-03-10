export default function handler(req, res) {
  res.status(200).json({
    message: 'Test API function working',
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  })
}