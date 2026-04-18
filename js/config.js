/* ============================================================
   CONFIG.JS — Runtime configuration (edit here to rotate keys)
   ============================================================
   This file is loaded before every other module and exposes
   settings on window.APP_CONFIG. Nothing in this file is secret
   by design — the Supabase publishable key is meant to be shipped
   to the browser. Access control is enforced server-side via RLS
   policies and the security-definer RPC functions in
   supabase/schema.sql.

   To rotate the Supabase anon key:
     1. Regenerate it in Supabase dashboard → API settings
     2. Replace the value below
     3. Redeploy (build.py will cache-bust the asset)
   ============================================================ */

'use strict';

window.APP_CONFIG = {
  supabase: {
    url: 'https://cduivsioupjytthaosgx.supabase.co',
    anonKey: 'sb_publishable_NONIyKO7mTs535VewUwk8Q_TBEV0bxd'
  }
};
