import { Link } from "react-router-dom";
import TitleIcon from "@/assets/title-icon";

import styles from "news-site-css/dist/header.module.css";

/**
 * Renders the Header view.
 */
export default function Header() {
    return (
        <header className={styles["page-header"]}>
            <Link to="/" className={styles["page-header-title"]}>
                <TitleIcon />
            </Link>
        </header>
    );
}
