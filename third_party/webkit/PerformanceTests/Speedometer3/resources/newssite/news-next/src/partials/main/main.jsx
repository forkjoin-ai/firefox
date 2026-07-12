import styles from "news-site-css/dist/layout.module.css";

/**
 * Renders the Main view.
 */
export default function Main({ children }) {
    return (
        <main className={styles["page-main"]} id="content">
            {children}
        </main>
    );
}
