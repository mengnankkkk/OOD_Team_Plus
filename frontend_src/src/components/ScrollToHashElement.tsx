import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SCROLL_OPTIONS: ScrollIntoViewOptions = { behavior: "smooth", block: "start" };

const scrollToHash = (rawHash: string) => {
    if (!rawHash) return;
    const id = decodeURIComponent(rawHash.replace(/^#/, ""));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    // Wait one frame so any post-navigation layout (lazy content,
    // sticky-header transitions) settles before we measure the target.
    requestAnimationFrame(() => el.scrollIntoView(SCROLL_OPTIONS));
};

/**
 * Universal in-page hash scroll handler.
 *
 * Mount once near the router root (next to <ScrollRestoration />). All
 * in-page anchor entry points are covered, regardless of how triggered:
 *
 *   ✓ <a href="#section">      (intercepted via document click delegate)
 *   ✓ <Link to="#section">     (router updates useLocation().hash)
 *   ✓ navigate("#section")     (router updates useLocation().hash)
 *   ✓ direct URL edit / back   (browser fires `hashchange`)
 *
 * Why intercept native <a href="#x"> clicks
 * Letting the browser perform fragment navigation triggers a `popstate`
 * event, which causes React Router's <ScrollRestoration /> useLayoutEffect
 * to run BEFORE our scroll. With a saved scroll position keyed on the
 * default location key (typical on first navigation), it calls
 * `window.scrollTo(0, 0)` and locks the page at the top. Our smooth
 * scrollIntoView then runs but is immediately overridden, producing the
 * "URL changes but page does not scroll" symptom.
 *
 * By calling `e.preventDefault()` on hash-only anchor clicks and updating
 * the hash via `history.replaceState`, the router never sees a navigation
 * and ScrollRestoration stays out of the way.
 *
 * Modifier-key clicks (Cmd / Ctrl / Shift / Alt) and non-left-button
 * clicks fall through to native behaviour so "open in new tab" still
 * works as expected.
 */
const ScrollToHashElement = () => {
    const { hash } = useLocation();

    // (1) Router-driven hash changes: <Link to="#x">, navigate("#x").
    useEffect(() => {
        scrollToHash(hash);
    }, [hash]);

    // (2) Browser-direct hash changes: address-bar edit, back / forward.
    useEffect(() => {
        const onHashChange = () => scrollToHash(window.location.hash);
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, []);

    // (3) Native <a href="#x"> clicks — must intercept BEFORE the browser
    //     dispatches popstate, otherwise <ScrollRestoration /> wins.
    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (e.defaultPrevented) return;
            if (e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

            const target = e.target as Element | null;
            const anchor = target?.closest('a[href^="#"]') as HTMLAnchorElement | null;
            if (!anchor) return;
            // Honour explicit opt-outs.
            if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return;
            if (anchor.hasAttribute("download")) return;

            const href = anchor.getAttribute("href");
            if (!href || href === "#") return;

            const id = decodeURIComponent(href.slice(1));
            const el = document.getElementById(id);
            if (!el) return;

            e.preventDefault();
            el.scrollIntoView(SCROLL_OPTIONS);
            if (window.location.hash !== href) {
                window.history.replaceState(null, "", href);
            }
        };

        document.addEventListener("click", onClick);
        return () => document.removeEventListener("click", onClick);
    }, []);

    return null;
};

export default ScrollToHashElement;
