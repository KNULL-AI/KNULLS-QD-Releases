import { useEffect, useRef } from "react";
import { db } from "@/lib/db";
import toast from "react-hot-toast";

/**
 * Hook to listen for global trigger events from Discord bot
 * Automatically matches PIDs and launches task groups
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
              await handleTriggerEvent(msg.event);
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

/**
 * Handle incoming trigger event and auto-launch matching task group
 */
async function handleTriggerEvent(event) {
  const { retailer, url, urls, type } = event;

  console.log(`[triggers] Event: retailer=${retailer}, type=${type}`, { url, urls });

  try {
    if (retailer === "walmart" && urls && urls.length > 0) {
      // Walmart: match URLs against whitelist
      for (const walmartUrl of urls) {
        const matchedSku = extractAndMatchSku(walmartUrl);
        if (matchedSku) {
          console.log(`[triggers] Matched Walmart SKU: ${matchedSku}`);
          await launchTaskGroup("walmart", walmartUrl);
        }
      }
    } else if (retailer === "pokemon-center") {
      // Pokemon Center: any Queue or Security alert triggers
      console.log(`[triggers] Pokemon Center ${type} alert detected`);
      await launchTaskGroup("pokemon-center", null);
    } else if (retailer === "costco") {
      // Costco: URL provided, just trigger
      console.log(`[triggers] Costco alert detected`);
      await launchTaskGroup("costco", url);
    }
  } catch (err) {
    console.error("[triggers] Error handling trigger:", err);
    toast.error(`Trigger error: ${err.message}`);
  }
}

/**
 * Extract SKU from Walmart URL and check whitelist
 */
function extractAndMatchSku(url) {
  if (!url || !skuWhitelistRef.current) return null;

  try {
    // Try to extract SKU from various Walmart URL formats
    // Common pattern: ?skuId=123456789 or /ip/123456789
    const skuMatch = url.match(/(?:skuId=|\/ip\/)(\d+)/);
    if (!skuMatch) return null;

    const sku = skuMatch[1];
    if (skuWhitelistRef.current.has(sku)) {
      return sku;
    }
  } catch (err) {
    console.error("[triggers] Error extracting SKU:", err);
  }

  return null;
}

/**
 * Launch task group with auto-filled URL
 */
async function launchTaskGroup(retailer, url) {
  try {
    // Get configured task group for this retailer
    const taskGroups = await db.TaskGroup?.list?.() || [];
    const matching = taskGroups.find(tg =>
      tg.name?.toLowerCase().includes(retailer.toLowerCase())
    );

    if (!matching) {
      console.warn(`[triggers] No task group found for retailer: ${retailer}`);
      toast.warning(`No task group configured for ${retailer}`);
      return;
    }

    console.log(`[triggers] Launching task group: ${matching.name}`, { url });

    // If URL provided, update task group temporarily
    if (url && matching.config?.target_url !== undefined) {
      const updated = { ...matching, config: { ...matching.config, target_url: url } };
      await db.TaskGroup?.update?.(matching.id, updated);
    }

    // Emit launch event that CaptchaSolver or main process can listen to
    window.dispatchEvent(
      new CustomEvent("triggerLaunchTaskGroup", {
        detail: { taskGroupId: matching.id, url },
      })
    );

    toast.success(`Launched: ${matching.name}`);
  } catch (err) {
    console.error("[triggers] Failed to launch task group:", err);
    toast.error(`Failed to launch task group: ${err.message}`);
  }
}
