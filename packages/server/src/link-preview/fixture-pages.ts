// Pages for the `<head>` parser's tests (101), kept as strings so the
// formatter leaves their deliberately odd markup alone.

export const OG_FULL = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fallback title | Example News</title>
  <meta name="description" content="The plain description.">
  <meta property="og:title" content="Rivers are getting warmer">
  <meta property="og:description" content="A study of 300 rivers finds water temperatures rising faster than the air above them.">
  <meta property="og:site_name" content="Example News">
  <meta property="og:image" content="https://cdn.example.test/rivers/hero.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="A river at dawn">
  <meta name="twitter:title" content="Not this one">
  <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="icon" href="/favicon-96.png" sizes="96x96" type="image/png">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
</head>
<body>
  <meta property="og:title" content="A tag in the body is ignored">
</body>
</html>`;

export const TWITTER_ONLY = `<!DOCTYPE html>
<HTML LANG="en">
<HEAD>
<TITLE>Docs home</TITLE>
<META NAME="twitter:title" CONTENT="Getting started">
<META NAME="twitter:description" CONTENT="Install the CLI, then run it.">
<META NAME="twitter:image:src" CONTENT="/img/card.png">
<META NAME="twitter:image:alt" CONTENT="The CLI in a terminal">
<LINK REL="apple-touch-icon" HREF="/touch.png" SIZES="180x180">
</HEAD>
<BODY></BODY>
</HTML>`;

export const PLAIN = `<html><head>
<title>
  A   plain
  page
</title>
<meta name="description" content="Nothing but the basics.">
</head><body><p>Hello</p></body></html>`;

export const MESSY = `<!doctype html>
<html>
<head>
<!-- <meta property="og:title" content="Commented out"> -->
<base href="https://static.example.test/assets/">
<script>
  document.write('<meta property="og:title" content="From a script">');
</script>
<style>meta { display: none } /* <title>From a style</title> */</style>
<title>Tom &amp; Jerry&#39;s &quot;Guide&quot; &mdash; &#x263A;</title>
<meta property=og:description content="&lt;b&gt;Bold&lt;/b&gt; claims   and
  <i>markup</i> stripped">
<meta property='og:image' content='images/card.webp'>
<meta property="og:image:width" content="not a number">
<meta property="og:site_name" content="">
<link rel="mask-icon" href="/mask.svg">
<link rel="shortcut icon" href="favicon.ico">
<link rel="icon" href="javascript:alert(1)">
</head>
<body></body>
</html>`;

/** `<title>Café crème</title>` in ISO-8859-1 bytes. */
export const LATIN1 = new Uint8Array(
  Buffer.from(
    '<html><head><meta charset="iso-8859-1"><title>Café crème</title></head></html>',
    "latin1"
  )
);
