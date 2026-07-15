export interface BuyBoxOffer {
  productId: string;
  agentId: string;
  price: number;
  condition: string;
}

export interface BuyBoxView {
  variantId: string;
  offerCount: number;
  lowestPrice: number | null;
  winnerAgentId: string | null;
  myOffer: { productId: string; price: number; condition: string; rank: number } | null;
  iAmWinning: boolean;
  priceToWin: number | null;
}

// `offers` must be in Buy Box order: price ascending, earliest offer first on ties.
export function computeBuyBox(variantId: string, offers: BuyBoxOffer[], agentId: string): BuyBoxView {
  if (offers.length === 0) {
    return { variantId, offerCount: 0, lowestPrice: null, winnerAgentId: null, myOffer: null, iAmWinning: false, priceToWin: null };
  }

  const winner = offers[0];
  const myIndex = offers.findIndex((offer) => offer.agentId === agentId);

  if (myIndex === -1) {
    return {
      variantId,
      offerCount: offers.length,
      lowestPrice: winner.price,
      winnerAgentId: winner.agentId,
      myOffer: null,
      iAmWinning: false,
      priceToWin: null,
    };
  }

  const mine = offers[myIndex];
  const iAmWinning = myIndex === 0;
  // Already leading → nothing to do; otherwise undercut the current lowest by 1.
  const priceToWin = iAmWinning ? 0 : mine.price - winner.price + 1;

  return {
    variantId,
    offerCount: offers.length,
    lowestPrice: winner.price,
    winnerAgentId: winner.agentId,
    myOffer: { productId: mine.productId, price: mine.price, condition: mine.condition, rank: myIndex + 1 },
    iAmWinning,
    priceToWin,
  };
}
