import axios from "axios";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

export const paystackService = {
  initializePayment: async (email, amount) => {
    try {
      const response = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        { email, amount: amount * 100 },
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
      );
      return response.data;
    } catch (error) {
      console.log(error);
    }
  },

  verifyPayment: async (reference) => {
    try {
      const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
      );
      return response.data;
    } catch (error) {
      console.log(error);
    }
  },
};
