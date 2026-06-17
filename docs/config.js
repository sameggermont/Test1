// ─────────────────────────────────────────────────────────────────────────
//  what2play configuration — the ONLY file you need to edit to start
//  earning affiliate revenue.
//
//  Visitors choose their country at the top of the page. That choice
//  decides which Amazon store the buy button uses and whether the
//  bol.com button appears (Belgium & Netherlands only).
//
//  AMAZON — https://affiliate-program.amazon.com
//  Amazon tracking IDs are PER COUNTRY: a tag from amazon.com earns
//  nothing on amazon.nl, and vice versa. Sign up separately for each
//  marketplace you care about (each takes minutes once the first is
//  approved) and paste each tag below. Countries without a tag still
//  get a working link, it just doesn't earn commission yet.
//    Belgium → BE (amazon.com.be), Netherlands → NL (amazon.nl),
//    Germany → DE (amazon.de), Other → US (amazon.com).
//
//  BOL.COM — https://affiliate.bol.com  (Netherlands & Belgium)
//  Sign up for the Bol Partner Program, find your site ID
//  ("site-id" in the links their link generator makes) and paste it
//  below. Belgium/Netherlands visitors then see a bol.com button next
//  to the Amazon one.
// ─────────────────────────────────────────────────────────────────────────
window.W2P_CONFIG = {
  amazonMarkets: {
    US: { domain: "www.amazon.com",    tag: "YOURTAG-20" },
    UK: { domain: "www.amazon.co.uk",  tag: "" },
    DE: { domain: "www.amazon.de",     tag: "" },
    FR: { domain: "www.amazon.fr",     tag: "" },
    BE: { domain: "www.amazon.com.be", tag: "" },
    NL: { domain: "www.amazon.nl",     tag: "" },
  },
  amazonDefault: "US",   // market used when we can't tell where the visitor is

  bolSiteId: "",         // ← your bol.com partner site ID, e.g. "1234567"
};
