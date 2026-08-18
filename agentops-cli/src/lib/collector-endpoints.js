const otlpHttpEndpoint = 'http://127.0.0.1:4318';
const collectorHealthUrl = 'http://127.0.0.1:13133';
const collectorHealthUrlWithSlash = `${collectorHealthUrl}/`;

module.exports = {
  collectorHealthUrl,
  collectorHealthUrlWithSlash,
  otlpHttpEndpoint
};
