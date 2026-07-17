import { Routes, Route } from "react-router-dom";
import Layout from "./components/layout/Layout";
import HomePage from "./pages/HomePage";
import CollectionPage from "./pages/CollectionPage";
import ProductPage from "./pages/ProductPage";
import WishlistPage from "./pages/WishlistPage";
import ContentPage from "./pages/ContentPage";
import NotFoundPage from "./pages/NotFoundPage";
import CheckoutPage from "./pages/CheckoutPage";
import CheckoutSuccessPage from "./pages/CheckoutSuccessPage";
import AccountPage from "./pages/AccountPage";
import AffiliatePage from "./pages/AffiliatePage";
import AdminLayout from "./components/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminProducts from "./pages/admin/AdminProducts";
import AdminCustomers from "./pages/admin/AdminCustomers";
import AdminCampaigns from "./pages/admin/AdminCampaigns";
import AdminAffiliates from "./pages/admin/AdminAffiliates";
import AdminLoyalty from "./pages/admin/AdminLoyalty";
import AdminShipping from "./pages/admin/AdminShipping";
import AdminSync from "./pages/admin/AdminSync";
import AdminInbox from "./pages/admin/AdminInbox";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="collections/:slug" element={<CollectionPage />} />
        <Route path="products/:slug" element={<ProductPage />} />
        <Route path="wishlist" element={<WishlistPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="checkout/success" element={<CheckoutSuccessPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="affiliate" element={<AffiliatePage />} />
        <Route path="pages/:slug" element={<ContentPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* Back office — demo preview of Phases 3–9 */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="products" element={<AdminProducts />} />
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="campaigns" element={<AdminCampaigns />} />
        <Route path="affiliates" element={<AdminAffiliates />} />
        <Route path="loyalty" element={<AdminLoyalty />} />
        <Route path="shipping" element={<AdminShipping />} />
        <Route path="sync" element={<AdminSync />} />
        <Route path="inbox" element={<AdminInbox />} />
      </Route>
    </Routes>
  );
}
