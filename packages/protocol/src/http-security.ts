/**
 * Browser write requests send this non-simple header as an explicit CSRF signal.
 * Cross-site forms cannot add it, and cross-origin fetches require a successful
 * CORS preflight before the browser will send the write request.
 */
export const BEECODE_CSRF_HEADER_NAME = "x-beecode-csrf";
export const BEECODE_CSRF_HEADER_VALUE = "1";
