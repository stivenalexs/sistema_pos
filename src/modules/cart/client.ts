// Browser-safe API of the cart module (D-077): pure rules and Client
// Components, nothing that runs only on the server. Client Components of
// other modules import from "@/modules/cart/client"; server code can keep
// using "@/modules/cart", which re-exports this file.
export { AddToCartForm } from "./ui/add-to-cart-form";
