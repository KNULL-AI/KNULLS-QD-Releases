import { db } from "@/lib/db";

export function useLogger(source) {
  const write = (level, message, details = null) => {
    db.SystemLog.create({
      level,
      source,
      message,
      details: details instanceof Error
        ? `${details.message}\n${details.stack}`
        : details ? String(details) : null,
    }).catch(() => {}); // never let logging itself crash the app
  };

  return {
    info:  (msg, details) => write("info",  msg, details),
    warn:  (msg, details) => write("warn",  msg, details),
    error: (msg, details) => write("error", msg, details),
    crash: (msg, details) => write("crash", msg, details),
  };
}