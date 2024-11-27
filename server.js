const stripe = require('stripe')(''); // Replace with your Stripe secret key
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs/promises');

(async () => {
  try {
    const invoicesData = [];

    // Fetch active subscriptions from Stripe
    const activeSubscriptions = await stripe.subscriptions.list({
      status: 'active', // Fetch only active subscriptions
      limit: 100,         // Number of subscriptions to fetch (max: 100)
    });

    console.log('Active Subscriptions:', activeSubscriptions.data);

    // Loop through each subscription to fetch invoice details
    for (const subscription of activeSubscriptions.data) {
      try {
        console.log(`Fetching invoices for Subscription ID: ${subscription.id}, Customer ID: ${subscription.customer}`);

        // Fetch invoices for the customer
        const invoices = await stripe.invoices.list({
          customer: subscription.customer, // Customer ID associated with the subscription
          limit: 100,                      // Fetch up to 100 invoices
        });

        if (invoices.data.length > 0) {
          // Sort invoices by creation date to get the first and last invoices
          invoices.data.sort((a, b) => a.created - b.created);

          const firstInvoiceId = invoices.data[0].id; // First invoice ID
          const lastInvoiceId = invoices.data[invoices.data.length - 1].id; // Last invoice ID

          const customer = await stripe.customers.retrieve(subscription.customer);
          invoicesData.push({
            subscriptionId: subscription.id,
            customerId: subscription.customer,
            customerEmail: customer.email,
            firstInvoiceId: firstInvoiceId,
            lastInvoiceId: lastInvoiceId,
          });

          console.log(`Customer ${subscription.customer}: First Invoice - ${firstInvoiceId}, Last Invoice - ${lastInvoiceId}, Email - ${customer.email}`);
        } else {
          console.log(`No invoices found for Customer ${subscription.customer}`);
        }
      } catch (error) {
        console.error(`Error fetching invoices for Customer ${subscription.customer}:`, error.message);
      }
    }

    // Save the initial invoices data to a JSON file
    await fs.writeFile('invoices.json', JSON.stringify(invoicesData, null, 2), 'utf8');
    console.log('Invoices data saved to invoices.json');

    // Read the saved invoices data
    const invoicesJson = await fs.readFile('invoices.json', 'utf8');
    const invoicesDataFromFile = JSON.parse(invoicesJson);

    // Helper function to fetch invoice details
    const getInvoiceDetails = async (invoiceId) => {
      try {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        return {
          subtotal: invoice.subtotal,
          totalDiscountAmounts: invoice.total_discount_amounts || 0, // Default to empty array if no discounts
          totalAmount: invoice.total,
        };
      } catch (error) {
        console.error(`Error fetching invoice details for ID ${invoiceId}:`, error.message);
        return { subtotal: null, totalDiscountAmounts: 0, totalAmount: null };
      }
    };

    // Helper function to fetch checkout session details
    const getCheckoutSessionDetails = async (subscriptionId) => {
      try {
        const sessions = await stripe.checkout.sessions.list({
          subscription: subscriptionId,
          limit: 1, // Assuming one session per subscription
        });

        if (sessions.data.length > 0) {
          const checkoutSession = sessions.data[0];
          return {
            status: checkoutSession.status,
            id: checkoutSession.id,
            completeJson: JSON.stringify(checkoutSession), // Full JSON of checkout session
          };
        } else {
          console.log(`No checkout session found for Subscription ${subscriptionId}`);
          return {};
        }
      } catch (error) {
        console.error(`Error fetching checkout session for Subscription ${subscriptionId}:`, error.message);
        return {};
      }
    };

    // Helper function to fetch payment intent details
    const getPaymentIntentDetails = async (paymentIntentId) => {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        return JSON.stringify(paymentIntent); // Return the complete payment intent JSON as a string
      } catch (error) {
        console.error(`Error fetching payment intent ${paymentIntentId}:`, error.message);
        return null;
      }
    };

    // Prepare the CSV Writer
    const csvWriter = createCsvWriter({
      path: 'invoices_updated.csv', // Output CSV file path
      header: [
        { id: 'subscriptionId', title: 'Subscription ID' },
        { id: 'customerId', title: 'Customer ID' },
        { id: 'customerEmail', title: 'Customer Email' },
        { id: 'firstInvoiceId', title: 'First Invoice ID' },
        { id: 'lastInvoiceId', title: 'Last Invoice ID' },
        { id: 'firstInvoiceSubtotal', title: 'First Invoice Subtotal' },
        { id: 'firstInvoiceTotal', title: 'First Invoice Total' },
        { id: 'firstInvoiceDiscounts', title: 'First Invoice Discounts' },
        { id: 'lastInvoiceSubtotal', title: 'Last Invoice Subtotal' },
        { id: 'lastInvoiceTotal', title: 'Last Invoice Total' },
        { id: 'lastInvoiceDiscounts', title: 'Last Invoice Discounts' },
        { id: 'checkoutSessionStatus', title: 'Checkout Session Status' },
        { id: 'checkoutSessionId', title: 'Checkout Session ID' },
        { id: 'checkoutSessionCompleteJson', title: 'Checkout Session Complete Json' },
        { id: 'paymentIntentCreated', title: 'Payment Intent Created' },
        { id: 'paymentIntentCompleteJson', title: 'Payment Intent Complete Json' },
      ],
    });

    // Update the invoices data with additional details
    const csvData = [];

    for (const invoice of invoicesDataFromFile) {
      const firstInvoiceId = invoice.firstInvoiceId;
      const lastInvoiceId = invoice.lastInvoiceId;

      // Fetch details for the first and last invoice IDs
      const firstInvoiceDetails = await getInvoiceDetails(firstInvoiceId);
      const lastInvoiceDetails = await getInvoiceDetails(lastInvoiceId);

      // Fetch checkout session details
      const checkoutSessionDetails = await getCheckoutSessionDetails(invoice.subscriptionId);

      // Fetch payment intent details from the last invoice
      let paymentIntentDetails = {};
      if (lastInvoiceDetails.totalAmount !== null) {
        try {
          const invoiceDetails = await stripe.invoices.retrieve(lastInvoiceId);
          if (invoiceDetails.payment_intent) {
            paymentIntentDetails = await getPaymentIntentDetails(invoiceDetails.payment_intent);
          }
        } catch (error) {
          console.error(`Error fetching payment intent for invoice ${lastInvoiceId}:`, error.message);
        }
      }

      // Add all necessary details to csvData
      csvData.push({
        subscriptionId: invoice.subscriptionId,
        customerId: invoice.customerId,
        customerEmail: invoice.customerEmail,
        firstInvoiceId: firstInvoiceId,
        lastInvoiceId: lastInvoiceId,
        firstInvoiceSubtotal: firstInvoiceDetails.subtotal,
        firstInvoiceTotal: firstInvoiceDetails.totalAmount,
        firstInvoiceDiscounts: JSON.stringify(firstInvoiceDetails.totalDiscountAmounts),
        lastInvoiceSubtotal: lastInvoiceDetails.subtotal,
        lastInvoiceTotal: lastInvoiceDetails.totalAmount,
        lastInvoiceDiscounts: JSON.stringify(lastInvoiceDetails.totalDiscountAmounts),
        checkoutSessionStatus: checkoutSessionDetails.status,
        checkoutSessionId: checkoutSessionDetails.id,
        checkoutSessionCompleteJson: checkoutSessionDetails.completeJson,
        paymentIntentCreated: paymentIntentDetails.created,
        paymentIntentCompleteJson: paymentIntentDetails || 'N/A',
      });
    }

    // Write to CSV
    await csvWriter.writeRecords(csvData);

    console.log('Invoices data with all details saved to invoices_updated.csv');
  } catch (error) {
    console.error('Error processing subscriptions:', error);
  }
})();
