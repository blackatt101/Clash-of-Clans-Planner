This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Development server (hot reload):

```bash
npm run dev          # http://localhost:3000
```

Production. Next.js is served **behind nginx**, which owns ports 80 and 443 and
terminates TLS:

```bash
npm run build
npm run start        # Next on 127.0.0.1:3000 (loopback only)
sudo systemctl restart nginx
```

Open **https://172.31.45.153/** — there is no port number, and plain `http://` on
the same host redirects to it. `npm run start:direct` skips the proxy and binds
`0.0.0.0:3000` over plain HTTP, for when nginx is not in the picture.

### The certificate

`/etc/ssl/coc-planner/` holds a **local** CA (`ca.crt`) and the server
certificate it signed. A public CA (Let's Encrypt) is not an option here: this
host is reached on a private address behind NAT with no domain, and no public CA
can attest to that.

So each browser must trust the CA once, by installing **http://172.31.45.153/ca.crt**
(that URL is exempt from the HTTPS redirect, precisely so it stays reachable):

| Where | How |
|---|---|
| Windows | download → double-click → *Local Machine* → *Place all certificates in* → **Trusted Root Certification Authorities** |
| macOS | double-click → Keychain *System* → set to **Always Trust** |
| Linux | `sudo cp ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates` |
| Firefox (any OS) | Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import, tick *Trust this CA to identify websites* |
| Android | Settings → Security → Encryption & credentials → Install a certificate → **CA certificate** |
| iOS | install the profile, then Settings → General → About → Certificate Trust Settings → enable full trust |

Until then the browser warns; clicking through still loads the app.

Trusting the CA is what makes the page a real *secure context*, and that is what
the clipboard needs: `navigator.clipboard.readText()` is blocked on plain
`http://` (except on `localhost`), so without it the "Paste from clipboard"
button stays disabled. Pasting with Ctrl+V always works and is the fallback the
import panel uses.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## AI Attack Strategy Generator

Upload an enemy base screenshot, confirm your Town Hall, and the app asks the
AI (server-side, one model, one request per plan) to draft a base-specific
attack plan: strategy + why, army (troops/spells/siege/CC troops), deployment
steps, troop paths, spell placements, hero abilities and phases. The result
renders as an interactive SVG overlay on top of your screenshot (the base is
never redrawn), with step-by-step playback, zoom/pan, marker editing, and PNG
export. The structured strategy JSON is the single source of truth; the
overlay is a programmatic rendering of it — no AI-generated imagery.

* Entry point: the gold **AI Attack** button in the header.
* Backend: `src/app/api/attack-strategy/route.ts` (validates + repairs the
  model output before it reaches the UI).
* Frontend: `src/components/attack/` (`AIAttackStrategy`, `AttackPlanViewer`,
  `AttackOverlay`, `AttackLegend`).
* Game catalog: `src/lib/attack/` (types, validator, geometry, icon mapping,
  export). The slug→Supercell-ID catalog in
  `src/lib/attack/catalog.generated.ts` is regenerated with
  `node scripts/gen_attack_catalog.mjs` (reads the `coc-data-test` dataset).
* Configuration: `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` in
  `.env.local` (see `.env.example`). The key is never exposed to the browser.
* Tests: `npm run test:attack` (slug resolution, capacities, coordinate
  clamping, validator reject/repair rules, step attribution) plus
  `npx tsx scripts/attack-render-check.mts` (renders the real overlay
  at every step: reveal rules, label/marker overlap, determinism).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# Clash-of-Clans-Planner
# Clash-of-Clans-Planner
# Clash-of-Clans-Planner
