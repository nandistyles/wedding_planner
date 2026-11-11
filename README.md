# Wedding tracker

A planning app for running weddings with a committee: a checklist, committee meetings with proper minutes, and the food budget. One installation handles many weddings. Each wedding has its own team, and a new wedding starts from a template checklist.

It's a static site (plain HTML, CSS and JavaScript, no build tools) hosted on **Vercel**, with data and sign-in on **Supabase**.

## What it does

- **Checklist**: tasks grouped by when they're due, each with a committee, the person responsible, a status and notes. Filter by committee, status, overdue items, or meeting actions.
- **Meetings and minutes**: every meeting follows the same agenda:
  1. **Matters arising**: open action points from earlier meetings, with their status updated on the spot.
  2. **Committee updates**: each committee records what was done, next steps and what they need help with. Committees that haven't reported are listed.
  3. **Decisions and minutes**: free text.
  4. **Action points**: each one has an owner and a due date. It goes on the checklist automatically and comes back under matters arising at every meeting until it's done.

  Past meetings without final minutes are flagged as **Minutes outstanding**, on the meeting and on the Today page. **Share minutes** formats the whole meeting as a WhatsApp message (copy, send on WhatsApp, or share), or prints it with signature lines. You can also save it as a PDF.
- **Dashboard**: countdown, checklist progress, budget paid vs owed, guests confirmed against the venue's seats, vendors booked, next meeting, what needs attention, and venue notes.
- **Main budget**: every line from the planner workbook by category: provider, contact, cost, deposit, amount paid, balance, pledges and status. The groceries line takes the Food list total and contingency is 10% of everything else, both worked out automatically. Optionally shows what each item cost at a previous wedding.
- **Guest list**: side, relationship, phone, reply, number of people, parking and seating, with confirmed people against the venue's seats and cars expected. Paste a whole list of names at once with **Add many**.
- **Vendors**: every service you need a phone number for on the day: who's booked, arrival time, and a tick when they've confirmed a week before. Share the list on WhatsApp.
- **Day schedule**: the day before and the wedding day, by time. Share it on WhatsApp or print it for vendors.
- **Food budget**: the caterer's list by group. Tick items as they're bought; totals update.
- **Team**: wedding details, committees, and who can sign in (planner, member or view only).
- **Many weddings**: a wedding list, a template for new weddings, archiving, JSON backups, and turning a finished wedding into the template for the next one.

Sign-in uses a 6-digit code sent by email, so nobody needs a password. Only people added to a wedding can see it. This is enforced by the database itself (row level security), not just by the app.

## What's in this repository

```
public/                 The website Vercel serves
  index.html            Page shell
  app.js                The app
  styles.css            Styles (including print layout for minutes)
  config.example.js     Template for local testing (public/config.js is generated)
scripts/write-config.mjs  Writes public/config.js from Vercel environment variables
supabase/
  migrations/           Database schema, access rules, functions, starter templates
  seed/                 Optional data: Mercy & Garikai, 5 Dec 2026
  reset_v1.sql          Only if you ran the first single-wedding setup file
vercel.json, package.json, .env.example
```

## First-time setup

Allow about 30 minutes.

### 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and create a new project. Choose the region closest to where most of the team lives, and save the database password somewhere safe.
2. When it's ready, open **SQL Editor → New query**. Paste the whole of `supabase/migrations/20261111000000_wedding_tracker.sql` and click **Run**.

   If you already ran the earlier `supabase_setup.sql` from the first version, run `supabase/reset_v1.sql` first. It removes the old tables.

### 2. Make yourself an app admin

App admins can see every wedding, create new ones and change the template. In the SQL Editor, run this with your own email in lower case:

```sql
insert into public.app_admins (email) values ('you@example.com');
```

### 3. Load Mercy & Garikai's wedding (optional)

Open `supabase/seed/mercy_garikai_2026.sql` and **change `your-email@example.com` on the last lines to your email**. Then run the whole file in the SQL Editor. This loads their 67-task checklist from the planner workbook, the 10 committees with their leads, and the Christec Caterers food list.

Skip this step if you'd rather create the wedding in the app, which starts it from the template instead.

### 4. Set up sign-in emails

In Supabase:

1. **Authentication → URL Configuration**
   - **Site URL**: your Vercel address, e.g. `https://wedding-tracker.vercel.app`. You'll get this in step 6, so come back and set it then.
   - **Redirect URLs**: add your Vercel address followed by `/**`. Add `http://localhost:3000/**` too if you'll test on your own computer.
2. **Authentication → Email Templates → Magic Link**: add the code to the email so people can type it in. For example:

   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code in the wedding tracker: <strong>{{ .Token }}</strong></p>
   <p>Or tap this link on the same phone: <a href="{{ .ConfirmationURL }}">Sign in</a></p>
   ```

   The code matters because email links often open in a different browser from the one the person started in, and then sign-in fails. Typing the code always works.
3. **Authentication → Providers → Email**: leave **Enable Email provider** on. Leave **Allow new users to sign up** on as well. Anyone can request a code, but they see nothing unless a planner has added their email to a wedding.
4. **Recommended: your own email sender.** Supabase's built-in sender only allows a few sign-in emails per hour. That's fine for testing but not for a committee signing in on the same evening. Under **Project Settings → Authentication → SMTP Settings**, connect a sending service (for example Resend, Brevo, or a Gmail account with an app password).

### 5. Put the code on GitHub

1. On GitHub, click **New repository**. Name it `wedding-tracker`, make it **Private**, and *don't* add a README, .gitignore or licence.
2. On your computer, in this folder (it's already a git repository with one commit), run:

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/wedding-tracker.git
   git push -u origin main
   ```

   If you'd rather not use the command line, use GitHub Desktop: **File → Add local repository**, choose this folder, then **Publish repository**.

### 6. Deploy on Vercel

1. At [vercel.com](https://vercel.com), click **Add New → Project** and import the `wedding-tracker` repository.
2. Set **Framework Preset** to **Other**. Leave the build and output settings as they are; `vercel.json` already sets them.
3. Under **Environment Variables**, add these two values (from Supabase → **Project Settings → API**):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL, e.g. `https://abcd1234.supabase.co` |
   | `SUPABASE_ANON_KEY` | The `anon` `public` key |

   You can also add `APP_NAME` to change the title shown before a wedding is opened.
4. Click **Deploy**. Then copy the site address into Supabase (step 4.1).

The anon key is meant to be public; the database's access rules are what protect the data. Still, it's kept out of git so you can switch Supabase projects by changing a setting rather than the code. **Never** put the `service_role` key anywhere in this project.

### 7. Add the team

Sign in, open the wedding, and go to **Team → Add person** for each committee member. Choose their committee and their access level, then send them the site link. They sign in with the email you added.

## Share links (no sign-in)

While sign-in emails aren't set up, a wedding can have a secret link: `https://your-site/?share=<key>`. Anyone with the link can view the wedding and edit tasks, meetings, committee updates and the food list, without signing in. Wedding details, committees and people stay with signed-in planners. Treat the link like a password: anyone who gets it can edit.

Run these in the Supabase SQL Editor (after `supabase/migrations/20261111120000_share_links.sql`):

```sql
-- turn on (or replace) a wedding's link; copy the share_key it returns
update public.weddings set share_key = replace(gen_random_uuid()::text, '-', '')
where couple_names = 'Mercy & Garikai' returning share_key;

-- turn it off
update public.weddings set share_key = null where couple_names = 'Mercy & Garikai';
```

## Access levels

| | View only | Member | Planner | App admin |
|---|---|---|---|---|
| See the wedding | ✓ | ✓ | ✓ | every wedding |
| Tasks, meetings, updates, food | read | add and edit | add and edit | add and edit |
| Delete meetings | | | ✓ | ✓ |
| Wedding details, committees, people | | | ✓ | ✓ |
| Create weddings, change the template, delete a wedding | | | | ✓ |

A person can belong to several weddings with a different role in each.

## Each new wedding

1. **Switch wedding → New wedding**. Enter the couple, date, venue, guests and your name. You can also copy the food list from an earlier wedding as a starting point.
2. The committees and checklist come from the template, with due dates counted back from the wedding date. Adjust or delete tasks that don't apply.
3. Fill in **Team → Wedding details** (time, address, caterer), set committee leads, and add people.

## After a wedding

1. **Team → Download backup** saves everything as a JSON file. Keep it with the couple's other files.
2. **Team → Wedding details → Archived** moves the wedding to the bottom of the list. Nothing is deleted.
3. If this wedding's checklist worked well, app admins can use **Team → Use as template for new weddings**. It replaces the template with this wedding's committees and tasks, with due dates kept relative to the wedding day. Meeting action points are left out.

## Running a meeting

1. Before the meeting, the chair or secretary creates it under **Meetings → New meeting**. The time, place, chair and secretary are copied from the last meeting.
2. During the meeting, work down the page: update the status of each matter arising, tap each committee under **Still to report** to record its update, write the decisions, and add action points as they're agreed.
3. Afterwards, the secretary checks everything, taps **Mark minutes final**, then **Share minutes → Send on WhatsApp** to the committee group.

## Testing on your own computer

```bash
cp public/config.example.js public/config.js   # then fill in your Supabase URL and anon key
npm run dev                                     # opens on http://localhost:3000
```

`public/config.js` is ignored by git.

## Changing the database later

Don't edit the existing migration file once it has been run. Put changes in a new file in `supabase/migrations/` with a later timestamp, e.g. `20270115000000_add_guest_list.sql`, and run it in the SQL Editor (or with `supabase db push` if you use the Supabase CLI). Then commit it, so the repository always describes the live database.

## Good to know

- **Free Supabase projects can be paused** after a period with no activity. If the app suddenly can't load anything between weddings, open the Supabase dashboard and restore the project. Data is kept.
- **Changing a wedding date** doesn't move existing due dates; adjust the tasks yourself.
- **Back up regularly** during planning (Team → Download backup). Supabase's free plan doesn't include point-in-time restore.

## Troubleshooting

| Problem | Fix |
|---|---|
| "The app isn't connected to its database yet" | The Vercel environment variables are missing. Add them, then redeploy. |
| Sign-in email never arrives | Check spam. If many people requested codes, you've hit Supabase's email limit; wait an hour or set up SMTP (step 4.4). |
| Email link opens a blank or signed-out page | Type the 6-digit code instead, and check the Redirect URLs (step 4.1). |
| Signed in but "isn't on any wedding team" | That exact email hasn't been added under Team, or was typed differently. |
| "new row violates row-level security policy" | The person is view only, or isn't on that wedding's team. |
| Can't see the New wedding button | Your email isn't in `app_admins` (step 2). |
