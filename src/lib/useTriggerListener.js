import { useEffect, useRef } from "react";
import { db } from "@/lib/db";
import { runTaskGroup } from "@/lib/taskGroupLauncher";
import toast from "react-hot-toast";

/**
 * Hook to listen for global trigger events from Discord bot
 * Automatically matches task groups by retailer name and launches them
 */
export function useTriggerListener(authToken) {
  const wsRef = useRef(null);
  const skuWhitelistRef = useRef(null);

  useEffect(() => {
    if (!authToken) return;

    // Load SKU whitelist once
    const loadWhitelist = async () => {
      try {
        const skus = (await db.WalmartSkuWhitelist?.list?.()) || [];
        skuWhitelistRef.current = new Set(skus.map(s => s.sku));
      } catch (err) {
        console.error("Failed to load SKU whitelist:", err);
      }
    };

    loadWhitelist();

    // Connect to trigger WebSocket
    const connectWebSocket = () => {
      try {
        const apiBase = import.meta.env.VITE_TRIGGER_API_BASE;
        if (!apiBase) {
          console.warn("VITE_TRIGGER_API_BASE not configured, skipping trigger listener");
          return;
        }

        const wsUrl = new URL(apiBase);
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
        wsUrl.pathname = "/v1/triggers";
        wsUrl.searchParams.set("token", authToken);

        const ws = new WebSocket(wsUrl.toString());

        ws.addEventListener("open", () => {
          console.log("[triggers] WebSocket connected");
        });

        ws.addEventListener("message", async (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "trigger") {
              await handleTriggerEvent(msg.event, skuWhitelistRef.current);
            }
          } catch (err) {
            console.error("[triggers] Failed to parse message:", err);
          }
        });

        ws.addEventListener("close", () => {
          console.log("[triggers] WebSocket closed, reconnecting in 5s...");
          setTimeout(() => connectWebSocket(), 5000);
        });

        ws.addEventListener("error", (err) => {
          console.error("[triggers] WebSocket error:", err);
        });

        wsRef.current = ws;
      } catch (err) {
        console.error("[triggers] Failed to connect WebSocket:", err);
        setTimeout(() => connectWebSocket(), 5000);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [authToken]);

  return null;
}

const normalize = (s) => (s || '').toLowerCase().replace(/[-\s_]/g, '');

/**
 * Handle incoming trigger event and auto-launch matching task group
 */
async function handleTriggerEvent(event, skuWhitelist) {
  const { retailer, url, urls, type } = event;

  console.log(`[triggers] Event: retailer=${retailer}, type=${type}`, { url, urls });

  try {
    if (retailer === "walmart" && urls && urls.length > 0) {
      for (const walmartUrl of urls) {
        const matchedSku = extractAndMatchSku(walmartUrl, skuWhitelist);
        if (matchedSku) {
          console.log(`[triggers] Matched Walmart SKU: ${matchedSku}`);
          await launchTaskGroup("walmart", walmartUrl);
        }
      }
    } else if (retailer === "pokemon-center") {
      console.log(`[triggers] Pokemon Center ${type} alert detected`);
      await launchTaskGroup("pokemon-center", null);
    } else if (retailer === "costco") {
      console.log(`[triggers] Costco alert detected`);
      await launchTaskGroup("costco", url);
    }
  } catch (err) {
    console.error("[triggers] Error handling trigger:", err);
    toast.error(`Trigger error: ${err.message}`);
  }
}

/**
 * Extract SKU from Walmart URL and check against whitelist
 */
function extractAndMatchSku(url, skuWhitelist) {
  if (!url || !skuWhitelist) return null;

  try {
    const skuMatch = url.match(/(?:skuId=|\/ip\/)(\d+)/);
    if (!skuMatch) return null;

    const sku = skuMatch[1];
    if (skuWhitelist.has(sku)) return sku;
  } catch (err) {
    console.error("[triggers] Error extracting SKU:", err);
  }

  return null;
}

/**
 * Find the matching task group by retailer name and run it
 */
async function launchTaskGroup(retailer, url) {
  try {
    const taskGroups = await db.TaskGroup?.list?.() || [];
    const normalizedRetailer = normalize(retailer);
    const matching = taskGroups.find(tg =>
      normalize(tg.name).includes(normalizedRetailer) ||
      normalize(tg.retailer).includes(normalizedRetailer)
    );

    if (!matching) {
      console.warn(`[triggers] No task group found for retailer: ${retailer}`);
      toast(`No task group configured for ${retailer}`, { icon: '⚠️' });
      return;
    }

    console.log(`[triggers] Launching task group: ${matching.name}`, { url });

    // For URL-based retailers, patch target_url before launching
    const taskGroupToRun = url ? { ...matching, target_url: url } : matching;
    if (url) {
      await db.TaskGroup?.update?.(matching.id, taskGroupToRun);
    }

    await runTaskGroup(taskGroupToRun);
    toast.success(`[Trigger] Launched: ${matching.name}`);
  } catch (err) {
    console.error("[triggers] Failed to launch task group:", err);
    toast.error(`Failed to launch task group: ${err.message}`);
  }
}
