import classnames from "classnames";

/**
 * Renders the Action Item view.
 */
export const ActionItem = ({ className, children }) => {
    return <div className={classnames("spectrum-ActionGroup-item", className)}>{children}</div>;
};

/**
 * Renders the Action Button view.
 */
export const ActionButton = ({ Icon, label, quiet, className, ...rest }) => {
    const buttonClassName = classnames("spectrum-ActionButton", "spectrum-ActionButton--sizeM", { "spectrum-ActionButton--quiet": quiet }, className);
    const text = label ? <span className="spectrum-ActionButton-label">{label}</span> : null;
    return (
        <button className={buttonClassName} {...rest}>
            {Icon && <Icon className="spectrum-Icon spectrum-Icon--sizeM spectrum-ActionButton-icon" focusable="false" aria-hidden="true" />}
            {text}
        </button>
    );
};

/**
 * Renders the Action Group view.
 */
export const ActionGroup = ({ children }) => {
    return <div className="spectrum-ActionGroup spectrum-ActionGroup--compact spectrum-ActionGroup--sizeM">{children}</div>;
};

/**
 * Renders the Action Group Vertical view.
 */
export const ActionGroupVertical = ({ children }) => {
    return <div className="spectrum-ActionGroup spectrum-ActionGroup--vertical spectrum-ActionGroup--sizeS">{children}</div>;
};
