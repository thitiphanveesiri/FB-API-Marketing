// Single source of truth for the Google Sheet layout.
// Used by the mapper (reading), the template generator, and the docs.
export interface SheetCol { name: string; required?: boolean; note: string }
export interface SheetTab { tab: string; required: boolean; purpose: string; cols: SheetCol[] }

const C = (name: string, note: string, required = false): SheetCol => ({ name, note, required });

export const SHEET_TABS: SheetTab[] = [
  { tab: "pages", required: true, purpose: "Facebook Pages you run ads / chat on", cols: [
    C("page_id", "Your own short ID, e.g. PG-1", true), C("name", "Page name", true), C("agency_id", "→ agencies.agency_id (blank = no agency)"),
    C("active", "TRUE / FALSE (blank = TRUE)"), C("sales_team", "Comma-separated user_id of salespeople, e.g. U-R1,U-R2"),
    C("ad_keywords", "Ad sync: comma-separated words in a campaign/ad name that belong to this page, e.g. danai,ดะนัย. A single * = every ad no other page matched") ] },
  { tab: "agencies", required: false, purpose: "Advertising agencies", cols: [
    C("agency_id", "e.g. AG-1", true), C("name", "Agency name", true), C("contact", "Contact person"), C("email", "Email"), C("active", "TRUE / FALSE") ] },
  { tab: "users", required: false, purpose: "People who use the dashboard (roles) and salespeople", cols: [
    C("user_id", "e.g. U-R1", true), C("name", "Full name", true), C("email", "Email"),
    C("role", "Administrator | Marketing Manager | Sales Manager | Sales Representative | Agency | Viewer", true), C("agency_id", "Required when role = Agency"), C("active", "TRUE / FALSE") ] },
  { tab: "campaigns", required: true, purpose: "Campaigns (one Page → many campaigns)", cols: [
    C("campaign_id", "Meta campaign ID or your own", true), C("name", "Campaign name", true), C("page_id", "→ pages.page_id", true), C("agency_id", "→ agencies.agency_id"), C("objective", "e.g. Messages") ] },
  { tab: "ads", required: true, purpose: "Ads (one campaign → many ads)", cols: [
    C("ad_id", "Meta Ad ID (the number from Ads Manager)", true), C("name", "Ad name", true), C("campaign_id", "→ campaigns.campaign_id", true),
    C("status", "Active | Paused | Learning | Ended"), C("creative_type", "Image | Video | Carousel"), C("updated_at", "YYYY-MM-DD"),
    C("creative_url", "https:// link to the ad image (Google Drive share link works)"), C("video_url", "https:// link to the ad video (.mp4, YouTube, or Facebook link)"),
    C("caption", "Primary text / ad copy (filled by the Meta ad sync; edits may be replaced on the next sync)"), C("headline", "Ad headline (filled by the Meta ad sync)"),
    C("page_id", "→ pages.page_id the ad posts as (blank = the campaign's page) — lets one campaign serve several pages"),
    C("creative_ref", "Written by the ad sync: where Meta keeps this ad's picture (s:post id, v:video id, i:Instagram media id, h:image hash). When the saved image link goes stale the dashboard asks Meta for a fresh one from this. Leave blank for a link you pasted yourself.") ] },
  { tab: "ad_performance", required: true, purpose: "Meta-reported results, one row per ad per day (paste Ads Manager export here)", cols: [
    C("date", "YYYY-MM-DD (or DD/MM/YYYY)", true), C("ad_id", "→ ads.ad_id", true), C("spend", "Amount spent", true), C("reach", "Reach"),
    C("impressions", "Impressions", true), C("clicks", "Link clicks"), C("clicks_all", "Clicks (all) — every click on the ad, written by the ad sync; blank = not synced"), C("messages", "Messaging conversations started"), C("purchases", "Meta-reported purchases") ] },
  { tab: "leads", required: true, purpose: "One row per customer conversation (Lead ID must be unique)", cols: [
    C("lead_id", "Unique, e.g. L-00001", true), C("name", "Customer name", true), C("page_id", "→ pages.page_id", true), C("ad_id", "Source ad (blank if unknown)"),
    C("assigned_to", "→ users.user_id (blank = unassigned)"),
    C("status", "Not Responded | Very Poor | Average | Qualified | Appointment Booked | Connection Created | New | In-Process | Intake | Converted", true),
    C("quality", "Not Responded | Very Poor | Average | Qualified | Appointment Booked | Connection Created (blank = derived from status)"),
    C("valid", "FALSE for spam / invalid leads — they are excluded from all rates"), C("created_at", "YYYY-MM-DD", true),
    C("last_contact_at", "YYYY-MM-DD or YYYY-MM-DD HH:MM"), C("last_message", "Last message text"), C("follow_up_date", "YYYY-MM-DD"), C("phone", "Phone"), C("email", "Email"),
    C("phone2", "Secondary phone (form exports)"), C("whatsapp", "WhatsApp number"), C("lead_source", "Where the lead came from, e.g. Paid / Organic (form exports)"),
    C("form", "Form / landing page name (form exports)"), C("labels", "Labels / tags from the source tool"),
    C("first_response_min", "Minutes until first reply (blank = never replied)"), C("follow_ups", "Number of follow-ups"), C("avg_follow_up_hrs", "Average hours between follow-ups"),
    C("unread", "TRUE / FALSE"), C("drop_reason", "Fill only for dropped leads: No Response | Not Interested | Price Too High | Chose Competitor | Rejected After Qualification | No Follow-up | Postponed"),
    C("dropped_at", "YYYY-MM-DD"), C("previous_status", "Status before it was dropped"), C("recovery_status", "Not Started | In Progress | Recovered | Lost"), C("last_activity", "Free text"),
    C("channel", "facebook | instagram | line | whatsapp (blank = facebook)"), C("fb_user_id", "Facebook user id (PSID) — filled in by the app; used to send replies") ] },
  { tab: "messages", required: false, purpose: "Optional chat history shown in Inbox / lead drawer", cols: [
    C("message_id", "Unique"), C("lead_id", "→ leads.lead_id", true), C("direction", "in (customer) | out (staff) | note (internal)", true), C("text", "Message text"),
    C("sent_at", "YYYY-MM-DD HH:MM", true), C("attachment_name", "File name, if any"), C("sent_by", "→ users.user_id of the salesperson who sent an 'out' message from the dashboard (blank = sent elsewhere)"),
    C("sender_type", "customer | human | automated | unknown; unknown when Meta provides no verified sender source"), C("sender_app", "Meta app id that sent an 'out' message (filled in by the webhook; use it in auto_replies)") ] },
  { tab: "auto_replies", required: false, purpose: "Rules that recognise the page's AUTOMATIC messages (greeting, away message, bot) so they do not count as a reply in SLA / follow-up. Edit freely: applies to all history", cols: [
    C("pattern", "Text to look for (case and extra spaces ignored). Use * for changing parts, e.g. สวัสดีค่ะ คุณ*, ขอบคุณที่ติดต่อ. For match=app_id: the sender's app id", true),
    C("match", "contains (default) | exact | starts_with | app_id"), C("active", "TRUE / FALSE (blank = TRUE)"), C("note", "Free text: where this message comes from") ] },
  { tab: "lead_log", required: false, purpose: "History of stage changes and internal notes per lead (written by the app)", cols: [
    C("lead_id", "→ leads.lead_id", true), C("at", "YYYY-MM-DD HH:MM", true), C("kind", "status | note", true), C("from", "Previous status"), C("to", "New status"), C("by", "Who did it"), C("text", "Note text / reason") ] },
  { tab: "evaluations", required: false, purpose: "Quality reviews of conversations (written by the app)", cols: [
    C("eval_id", "Unique", true), C("lead_id", "→ leads.lead_id", true), C("reviewer_id", "→ users.user_id"), C("at", "YYYY-MM-DD HH:MM"), C("quality", "New quality"), C("previous_quality", "Old quality"),
    C("responsiveness", "1-5"), C("need_identified", "1-5"), C("intent", "1-5"), C("contact_captured", "1-5"), C("notes", "Reviewer notes"), C("reason", "Reason for change") ] },
  { tab: "page_insights", required: false, purpose: "Daily Page Insights from Meta Business Suite (Upload page writes here)", cols: [
    C("page_id", "→ pages.page_id", true), C("date", "YYYY-MM-DD", true), C("reach", "Reach"), C("views", "Page views / impressions"), C("engagements", "Post engagements"),
    C("followers", "Total followers"), C("new_followers", "New followers"), C("link_clicks", "Link clicks") ] },
  { tab: "post_comments", required: false, purpose: "Customer comments under page posts, with the time the page replied (used by the response-check page)", cols: [
    C("comment_id", "Unique", true), C("page_id", "→ pages.page_id", true), C("post_id", "Post ID / link"), C("commenter", "Customer name"), C("text", "Comment text"),
    C("commented_at", "YYYY-MM-DD HH:MM", true), C("replied_at", "YYYY-MM-DD HH:MM (blank = not replied yet)"), C("replied_by", "→ users.user_id or name") ] },
  { tab: "posts", required: false, purpose: "Every Facebook / Instagram post the sync saw, including posts without comments (written by the comment sync; used by the Comments page)", cols: [
    C("post_id", "Post link or ID — the same value post_comments.post_id uses", true), C("page_id", "→ pages.page_id", true), C("channel", "facebook | instagram (blank = facebook)"),
    C("text", "Post text / caption"), C("posted_at", "YYYY-MM-DD HH:MM") ] },
  { tab: "push_subs", required: false, purpose: "Encrypted phones / browsers that receive alerts", cols: [
    C("endpoint", "SHA-256 key for encrypted subscription (unique)", true), C("user_id", "→ users.user_id", true),
    C("encrypted_subscription", "AES-256-GCM encrypted endpoint and keys"), C("created_at", "ISO time"), C("active", "TRUE / FALSE"),
    C("p256dh", "Legacy column; blank after migration"), C("auth", "Legacy column; blank after migration") ] },
  { tab: "notification_log", required: false, purpose: "Deduplication and audit trail for inbound-message and manual follow-up push notifications", cols: [
    C("notification_id", "Stable deduplication key", true), C("kind", "inbound | followup", true), C("lead_id", "→ leads.lead_id", true),
    C("message_ids", "Comma-separated Messenger message IDs, if inbound"), C("state_key", "Follow-up state fingerprint, if manual"),
    C("recipient_id", "→ users.user_id", true), C("actor_id", "Admin user_id for manual notifications"),
    C("sent_at", "ISO time"), C("status", "pending | sent | failed", true), C("sent_count", "Devices reached"), C("failed_count", "Device delivery failures"), C("detail", "Sanitized status detail") ] },
  { tab: "channels", required: false, purpose: "Chat channel connections (Facebook Messenger and linked Instagram Messaging; LINE / WhatsApp later). SECRET: holds access tokens — anyone who can open the sheet can read them", cols: [
    C("channel_id", "e.g. facebook:123456 or instagram:123456 (linked Facebook Page ID)", true), C("channel", "facebook | instagram | line | whatsapp", true), C("account_id", "Facebook Page ID / linked Instagram professional account ID / LINE channel ID / WhatsApp phone-number ID"), C("name", "Account name"),
    C("access_token", "Page access token (secret)"), C("app_secret", "App secret, used to verify webhook signatures (secret)"), C("verify_token", "Text you paste into Meta's webhook set-up"),
    C("sheet_page_id", "→ pages.page_id where the chats are stored"), C("force_sheet_page", "For ads: TRUE to store every ad in sheet_page_id instead of using a connected Facebook Page mapping"), C("active", "TRUE / FALSE"), C("updated_at", "When it was last saved") ] },
  { tab: "import_log", required: false, purpose: "One row per Upload (written by the app)", cols: [
    C("import_id", "e.g. IMP-001", true), C("at", "When"), C("page_id", "→ pages.page_id"), C("data_type", "Type of file"), C("file_name", "File name"), C("mode", "incremental | replace"),
    C("total", "Rows in file"), C("imported", "Rows imported"), C("failed", "Rows failed"), C("duplicates", "Rows skipped as duplicates"), C("by", "Who uploaded") ] },
];
export const TAB_NAMES = SHEET_TABS.map((t) => t.tab);
