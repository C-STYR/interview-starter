# Interview Starter App

A minimal Next.js application for technical interviews. This is a simple user management system that candidates will extend with background job processing.

## Tech Stack

- Next.js 15 (Pages Router)
- TypeScript
- Prisma ORM with SQLite
- Tailwind CSS
- Better Auth

## Setup

### Prerequisites

- Node.js 18+

### Steps

1. **Clone and install dependencies:**
   ```bash
   git clone <repo-url>
   cd interview-starter
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp .env.example .env
   ```

3. **Run database migrations:**
   ```bash
   npx prisma migrate dev
   ```

4. **Seed the database:**
   ```bash
   npx prisma db seed
   ```

5. **Start the dev server:**
   ```bash
   npm run dev
   ```

6. **Open http://localhost:3000**

## Test Credentials

| Email | Password | Organization |
|-------|----------|--------------|
| admin@acme.com | password | Acme Corp |
| admin@globex.com | password | Globex Inc |

---

## The Interview Exercise

We need to add background job processing for two features:

### 1. Welcome Emails

When a new user is created, send them a welcome email.
- For this exercise, just log to console what would be sent
- Don't actually send email

### 2. Weekly Digest

Every Monday at 9am, send all users a digest summarizing their org's activity.
- For this exercise, just log what would be sent
- "Activity" can be simple: new users added, total users, etc.

### Your Task

Add background job processing to handle these requirements. You have 45 minutes.

We're more interested in:
- How you think about the problem
- What questions you ask
- The tradeoffs you consider

Than whether you get it fully working.

---

## Project Structure

```
interview-starter/
├── pages/
│   ├── api/
│   │   ├── auth/[...all].ts    # Better Auth handler
│   │   └── users/
│   │       ├── index.ts        # GET/POST users
│   │       └── [id].ts         # GET/DELETE user
│   ├── users/
│   │   ├── index.tsx           # User list + create form
│   │   └── [id].tsx            # User detail
│   ├── _app.tsx
│   ├── index.tsx               # Redirects to dashboard
│   ├── login.tsx
│   └── dashboard.tsx
├── lib/
│   ├── prisma.ts               # Prisma client
│   ├── auth.ts                 # Better Auth server config
│   └── auth-client.ts          # Better Auth client
└── prisma/
    ├── schema.prisma
    └── seed.ts
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npx prisma studio` - Open Prisma database GUI
- `npx prisma migrate dev` - Run migrations
- `npx prisma db seed` - Seed database
