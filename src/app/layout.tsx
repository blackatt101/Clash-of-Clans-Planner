import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clash Max — Clash of Clans Upgrade Planner",
  description:
    "Free Clash of Clans upgrade planner: paste your village export and get a builder-accurate schedule for Home Village, Builder Base and the 6th Builder.",
};

// The build id is baked in so a stale tab can be told from the live one: the
// page footer shows it, and every captured error carries it (see error-capture
// below) so the server log says which build the browser was running.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        {/* Dev error-capture: POST unhandled browser errors to /api/debug so a
            broken build shows up in the server log, tagged with the build id. */}
        {process.env.NODE_ENV !== "production" && (
          <Script
            id="error-capture"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `(function(){
  window.__CLASH_BUILD_ID__ = "${BUILD_ID}";
  function send(extra){
    try{
      var info = Object.assign({ build: window.__CLASH_BUILD_ID__, href: location.href, ts: Date.now() }, extra);
      fetch('/api/debug',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(info) }).catch(function(){});
    }catch(_){}
  }
  window.addEventListener('error', function(e){
    send({ message:(e.message)||'window error', source:e.filename, line:e.lineno, col:e.colno, stack:(e.error&&e.error.stack)||'', type:'error' });
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    send({ message:'unhandledrejection', reason:String(e.reason), stack:(e.reason&&e.reason.stack)||'', type:'rejection' });
  });
})();`,
            }}
          />
        )}
      </body>
    </html>
  );
}
