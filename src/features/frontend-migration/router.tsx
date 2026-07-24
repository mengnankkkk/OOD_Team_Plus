"use client";

import NextLink from "next/link";
import { useParams as useNextParams, usePathname, useRouter, useSearchParams as useNextSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type NavigateOptions = { replace?: boolean };
type Navigate = (to: string | number, options?: NavigateOptions) => void;

export function useNavigate(): Navigate {
  const router = useRouter();
  return (to, options) => {
    if (typeof to === "number") {
      if (to < 0) router.back();
      else router.forward();
      return;
    }
    if (options?.replace) router.replace(to);
    else router.push(to);
  };
}

export function useLocation() {
  const pathname = usePathname() ?? "/";
  const searchParams = useNextSearchParams();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  const search = searchParams?.toString() ?? "";
  return useMemo(() => ({ pathname, search: search ? `?${search}` : "", hash }), [pathname, search, hash]);
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string>>() {
  return useNextParams<T>();
}

export function useSearchParams(): [URLSearchParams, (value: URLSearchParams | string) => void] {
  const params = useNextSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mutable = useMemo(() => new URLSearchParams(params?.toString() ?? ""), [params]);
  return [mutable, (value) => {
    const query = typeof value === "string" ? value : value.toString();
    const targetPath = pathname ?? "/";
    router.push(query ? `${targetPath}?${query}` : targetPath);
  }];
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; children?: ReactNode };

export function Link({ to, children, ...props }: LinkProps) {
  return <NextLink href={to} {...props}>{children}</NextLink>;
}

type NavLinkProps = Omit<LinkProps, "className"> & {
  end?: boolean;
  className?: string | ((state: { isActive: boolean }) => string);
};

export function NavLink({ to, end = false, className, children, ...props }: NavLinkProps) {
  const pathname = usePathname() ?? "/";
  const isActive = end ? pathname === to : to === "/" ? pathname === "/" : pathname.startsWith(to);
  const resolvedClassName = typeof className === "function" ? className({ isActive }) : className;
  return <NextLink href={to} className={resolvedClassName} {...props}>{children}</NextLink>;
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace }), [navigate, replace, to]);
  return null;
}

export function Outlet() {
  return null;
}
