import { useLocation } from "@/features/frontend-migration/router";
import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

const NotFound = () => {
    const location = useLocation();

    useEffect(() => {
        console.error(
            "404 Error: User attempted to access non-existent route:",
            location.pathname
        );
    }, [location.pathname]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-white">
            <div className="text-center">
                <Image src="/money-whisperer-logo.png" alt="Money Whisperer" width={120} height={120} className="mx-auto mb-2 object-contain opacity-80" />
                <p className="text-3xl font-bold mb-4 text-gray-700">页面待开发</p>
                <Link href="/" className="text-blue-500 hover:text-blue-700 underline">
                    返回首页
                </Link>
            </div>
        </div>
    );
};

export default NotFound;
