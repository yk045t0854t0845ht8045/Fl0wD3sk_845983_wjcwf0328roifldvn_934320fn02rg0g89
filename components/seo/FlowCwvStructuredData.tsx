type FlowCwvStructuredDataProps = {
  id?: string;
  payload: unknown;
};

export function FlowCwvStructuredData({
  id,
  payload,
}: FlowCwvStructuredDataProps) {
  return (
    <script
      {...(id ? { id } : {})}
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(payload).replace(/</g, "\\u003c"),
      }}
    />
  );
}
