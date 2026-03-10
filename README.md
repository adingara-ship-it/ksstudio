# KS Studio - Site + Reservation

## Prerequis
- Node.js 20+
- Projet Supabase deja cree
- Un SMTP pour les emails (Gmail SMTP, Mailgun SMTP, etc.)

## Installation
```bash
npm install
```

## Configuration env
1. Copier `.env.example` vers `.env`
2. Renseigner:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `ADMIN_SESSION_DURATION_SECONDS` (optionnel, defaut 28800 / 8h)
- `ADMIN_LOGIN_MAX_ATTEMPTS` (optionnel, defaut 5)
- `ADMIN_LOGIN_WINDOW_MS` (optionnel, defaut 900000 / 15 min)
- `ADMIN_LOGIN_BLOCK_MS` (optionnel, defaut 900000 / 15 min)
- `ANALYTICS_ACTIVE_WINDOW_MINUTES` (optionnel, defaut 5)
- `BOOKING_OWNER_EMAIL`
- `SMTP_*`
- `SITE_URL` (optionnel, ex: `https://ton-domaine.com`, utile pour les liens/images email)
- `MAIL_LOGO_URL` (optionnel, ex: `https://ton-domaine.com/logoks.png`, prioritaire sur `SITE_URL`)

Verification rapide de la connexion:
```bash
npm run db:check
```

## Base de donnees Supabase
Executer le SQL:
- `supabase/schema.sql`

Depuis l'editeur SQL Supabase, coller puis executer le contenu.
Puis relancer `npm run db:check` pour confirmer que les tables sont bien detectees.

## Lancer le projet
```bash
npm run dev
```

## Routes principales
- `/` : page vitrine
- `/reservation` : formulaire de reservation client
- `/admin/login` : connexion admin
- `/admin` : gestion disponibilites + rendez-vous
- `/admin/analytics` : affluence en temps reel

## APIs
- `GET /api/public/slots`
- `GET /api/public/slots?date=YYYY-MM-DD`
- `POST /api/bookings/create`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/availability`
- `POST /api/admin/availability`
- `DELETE /api/admin/availability/:id`
- `GET /api/admin/bookings`
- `POST /api/admin/bookings/:id/cancel`
- `POST /api/analytics/track`
- `GET /api/admin/analytics/realtime`
