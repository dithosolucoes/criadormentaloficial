<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Criador Mental - Full Stack with Supabase

This is a full-stack version of the Criador Mental application, powered by Supabase for the backend and a React frontend.

## Features

- **User Authentication:** Secure user sign-up and login managed by Supabase Auth.
- **Database:** Project and user data stored in a PostgreSQL database managed by Supabase, with Row Level Security (RLS) enabled.
- **File Storage:** Generated images are uploaded to Supabase Storage for efficient and secure hosting.
- **Edge Functions:** The Google Gemini API key is kept secure by proxying all AI requests through Supabase Edge Functions.

## Local Development Setup

**Prerequisites:**
- Node.js
- Docker (for the Supabase CLI)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### 1. Initialize Supabase Project

Start the Supabase services. This will spin up a local PostgreSQL database, Supabase Studio, and other necessary services in Docker.

```bash
supabase start
```

### 2. Set Up Environment Variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

The Supabase CLI will output your local Supabase credentials when you run `supabase start`. Update `.env.local` with these values:

```dotenv
# Supabase - Get these from the 'supabase start' command output
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_ANON_KEY="your-local-anon-key"

# Google Gemini API Key - Get this from Google AI Studio
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
```

### 3. Set Supabase Secrets

Our Edge Functions need the Gemini API key to work. Set it as a secret in your local Supabase project. The key will be read from your `.env.local` file.

```bash
supabase secrets set --env-file ./.env.local
```

### 4. Install Frontend Dependencies

```bash
npm install
```

### 5. Run the Application

Start the frontend development server:

```bash
npm run dev
```

Your application should now be running on `http://localhost:3000` and connected to your local Supabase instance.

## Populating with Seed Data

To get started with some example data, you can reset your local database. This command will re-apply the migrations and then run the `supabase/seed.sql` file.

```bash
supabase db reset
```

**Note:** This will wipe all data in your local database. The seed file has placeholder data. To see the projects, you must first **Sign Up** in the application, then find your new User ID in the Supabase Studio (`Authentication > Users`), and replace the placeholder `'<REPLACE_WITH_YOUR_USER_ID>'` in `supabase/seed.sql` before running `db reset` again.

## Supabase Storage Setup

For image generation to work, you **must** create a storage bucket in Supabase.

1.  Go to your Supabase Studio (usually `http://localhost:54323`).
2.  Navigate to the **Storage** section.
3.  Click **New bucket**.
4.  Enter the bucket name: `project_images`
5.  Make the bucket **public**.
6.  Set up policies to allow uploads. Go to `Storage > Policies` and create a new policy for the `project_images` bucket:
    - **Policy Name:** `Allow authenticated uploads`
    - **Allowed operations:** `select`, `insert`, `update`
    - **Policy Definition (USING expression):** `auth.role() = 'authenticated'`

## Deploying to Production

1.  **Create a new Supabase Project:** Go to [database.new](https://database.new) and create your project.

2.  **Link your local project:**
    ```bash
    supabase link --project-ref YOUR_PROJECT_ID
    ```

3.  **Push Database Migrations:**
    ```bash
    supabase db push
    ```

4.  **Deploy Edge Functions:**
    ```bash
    supabase functions deploy
    ```

5.  **Set Production Secrets:** Set your Gemini API key for the deployed functions.
    ```bash
    supabase secrets set GEMINI_API_KEY=YOUR_PRODUCTION_GEMINI_KEY
    ```

6.  **Set up Production Environment Variables:** Update your hosting provider (Vercel, Netlify, etc.) with your production Supabase URL and Anon Key.

7.  **Create Storage Bucket:** Manually create the `project_images` bucket in your production Supabase project dashboard, just as you did locally.
