export const HOMEPAGE_CHECK_CODE = `
exports.handler = async () => {
  const url = process.env.CHECK_URL;
  const expectedTitle = process.env.EXPECTED_TITLE;
  if (!url || !expectedTitle) {
    throw new Error('Homepage check configuration is incomplete.');
  }

  const response = await fetch(url, {
    headers: { 'user-agent': 'salih-dev-health-check/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  if (response.status < 200 || response.status >= 400) {
    throw new Error('Homepage returned HTTP ' + response.status);
  }

  const body = await response.text();
  const title = body.match(/<title[^>]*>([^<]*)<\\/title>/i)?.[1];
  if (!title || !title.includes(expectedTitle)) {
    throw new Error('Homepage title is missing or unexpected.');
  }

  console.log(JSON.stringify({ status: response.status, title, url: response.url }));
};
`;
