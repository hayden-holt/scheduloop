function InfoCard({ title, subtitle, className = "", id, children }) {
  return (
    <div id={id} className={`card info-card${className ? ` ${className}` : ""}`}>
      <div className="info-card-header">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="info-card-body">{children}</div>
    </div>
  );
}

export default InfoCard;
