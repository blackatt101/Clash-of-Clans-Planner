// Permissive cache control for the app shell: the page `/` is a static
// prerender, so `next start` would otherwise serve it with
// `Cache-Control: s-maxage=31536000` (365 days) and the browser would keep the
// old index.html — and the old content-hashed JS chunks it references — for a
// year, making every rebuild look like "nothing changed". The content-hashed
// chunks are safe to keep caching (their URLs change each build), but the
// document itself must revalidate on each visit so the browser picks up new
// chunk names.
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
