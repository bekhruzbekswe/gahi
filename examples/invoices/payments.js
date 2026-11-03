// A stand-in for a payment provider: it only records calls, and no money moves.
export function createPayments() {
  const sent = [];
  return {
    sent,
    send: async (invoice, { account }) => {
      sent.push({ invoice: invoice.id, amount: invoice.amount, account });
    },
  };
}
