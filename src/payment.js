/**
 * Stripe Payment Integration for KK Sync Server
 * 
 * This module handles:
 * - Checkout session creation (Pro/Team plans)
 * - Webhook handling (payment success/cancel)
 * - User provisioning after payment
 * 
 * Setup:
 * 1. Register at https://stripe.com
 * 2. Get API key from Dashboard
 * 3. Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET env vars
 * 4. Create products: "Pro Plan" ($9/mo) and "Team Plan" ($29/mo)
 * 5. Set webhook endpoint to /api/webhooks/stripe
 */

import { Hono } from "hono";

// Price IDs (create in Stripe Dashboard → Products)
const PRICES = {
  pro: process.env.STRIPE_PRICE_PRO || "price_pro_monthly",
  team: process.env.STRIPE_PRICE_TEAM || "price_team_monthly",
};

const PLAN_NAMES = {
  price_pro_monthly: "pro",
  price_team_monthly: "team",
};

export function registerPaymentRoutes(app, store) {
  // Create checkout session
  app.post("/api/checkout", async (c) => {
    const apiKey = c.req.header("Authorization")?.replace("Bearer ", "");
    const adminKey = process.env.ADMIN_KEY;
    
    // Allow both authenticated users and admin to create checkout
    if (!apiKey && !adminKey) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const rawBody = await c.req.text(); const body = JSON.parse(rawBody);

    if (!["pro", "team"].includes(body.plan)) {
      return c.json({ success: false, error: "Invalid plan. Choose 'pro' or 'team'." }, 400);
    }

    if (!body.email) {
      return c.json({ success: false, error: "Email required" }, 400);
    }

    // If Stripe is configured, create real checkout
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      try {
        const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            "mode": "subscription",
            "payment_method_types[0]": "card",
            "customer_email": body.email,
            "line_items[0][price]": PRICES[body.plan],
            "line_items[0][quantity]": "1",
            "success_url": body.successUrl || "https://zsc-glitch.github.io/knowledge-keeper-mcp/?checkout=success",
            "cancel_url": body.cancelUrl || "https://zsc-glitch.github.io/knowledge-keeper-mcp/?checkout=cancel",
            "metadata[plan]": body.plan,
            "metadata[email]": body.email,
          }),
        });

        const session = await response.json();
        
        if (session.url) {
          return c.json({ success: true, url: session.url });
        } else {
          return c.json({ success: false, error: session.error?.message || "Checkout creation failed" }, 500);
        }
      } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
      }
    }

    // Fallback: No Stripe configured, return manual upgrade instructions
    return c.json({
      success: false,
      error: "Payment not configured yet",
      instructions: "To upgrade, contact support or set up Stripe. Visit: https://zsc-glitch.github.io/knowledge-keeper-mcp/",
      plan: body.plan,
      price: body.plan === "pro" ? "$9/month" : "$29/month",
    }, 503);
  });

  // Stripe webhook
  app.post("/api/webhooks/stripe", async (c) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeKey || !webhookSecret) {
      return c.json({ error: "Webhooks not configured" }, 500);
    }

    const body = await c.req.text();
    const sig = c.req.header("stripe-signature");

    // In production, verify signature with Stripe SDK
    // For now, parse the event directly
    try {
      const event = JSON.parse(body);

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const email = session.metadata?.email || session.customer_email;
          const plan = session.metadata?.plan || "pro";

          // Create user account
          const result = store.createUser(email, plan);
          console.log(`✅ New ${plan} user: ${email} (API key: ${result.apiKey})`);

          // In production: send API key via email
          // For now: log it
          break;
        }

        case "customer.subscription.deleted": {
          // Downgrade user to free
          const sub = event.data.object;
          console.log(`⚠️ Subscription cancelled: ${sub.customer}`);
          // Find user by stripe_customer_id and downgrade
          break;
        }
      }

      return c.json({ received: true });
    } catch (error) {
      return c.json({ error: "Invalid payload" }, 400);
    }
  });

  // Pricing info
  app.get("/api/pricing", (c) => {
    return c.json({
      plans: [
        {
          id: "free",
          name: "Free",
          price: 0,
          period: "forever",
          features: ["30 MCP tools", "Local storage", "BM25 + semantic search", "Knowledge graph", "Obsidian compatible", "Community support"],
        },
        {
          id: "pro",
          name: "Pro",
          price: 9,
          period: "month",
          features: ["Everything in Free", "Cloud sync (E2E encrypted)", "Multi-device access", "Unlimited vaults", "Priority support", "Advanced analytics"],
          checkoutUrl: "/api/checkout",
        },
        {
          id: "team",
          name: "Team",
          price: 29,
          period: "month",
          features: ["Everything in Pro", "Up to 10 team members", "Shared knowledge base", "Role-based access", "Admin dashboard", "SLA guarantee"],
          checkoutUrl: "/api/checkout",
        },
      ],
      stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
    });
  });
}
