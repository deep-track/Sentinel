import { NotificationInbox } from "./notification-inbox";

// Your notifications across every organization you belong to.
export default function NotificationsPage() {
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Notifications</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Alerts about cases, screenings and credits. Your Admin chooses which alerts you get (Settings → Notifications).</p>
      </div>
      <NotificationInbox />
    </div>
  );
}
