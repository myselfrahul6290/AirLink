const os = require('os');

// Retrieve IPv4 LAN Addresses for network access
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// Normalize IP addresses (collapse IPv6 localhost to IPv4)
function normalizeIp(ip) {
  if (!ip) return '127.0.0.1';
  if (ip === '::1' || ip === '::ffff:127.0.0.1' || ip === '127.0.0.1') return '127.0.0.1';
  return ip.replace(/^::ffff:/, '');
}

module.exports = {
  getLocalIPs,
  normalizeIp
};
