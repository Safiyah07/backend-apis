export const mapPaystackToInternal = (psStatus) => {
  // Hybrid mapping chosen (C)
  switch (psStatus) {
    case "success":
      return "paid";
    case "failed":
      return "failed";
    case "abandoned":
      return "cancelled";
    case "reversed":
      return "refunded";
    case "timeout":
      return "expired";
    case "pending":
      return "pending";
    default:
      return psStatus; // fallback
  }
};
