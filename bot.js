#!/usr/bin/node

var Amount        = require("ripple-lib").Amount;
var Currency      = require("ripple-lib").Currency;
var Remote        = require("ripple-lib").Remote;
var UInt160       = require("ripple-lib").UInt160;
var extend	  = require("extend");
var irc	          = require("irc");
var gateways      = require("./config").gateways;
var irc_config    = require("./config").irc_config;
var remote_config = require("./config").remote_config;

extend(require("ripple-lib/src/js/config"), require("./config"));

var self  = this;

self.totalCoins = undefined;

var client = new irc.Client('irc.freenode.net', 'ripplebot', {
    userName: "ripplebot",
    realName: "Ripple IRC Bot",
    channels: ['#ripple-market', '#ripple-watch'],
    autoConnect: irc_config.enable,
});

client
  .on('error', function(message) {
      console.log("*** irc error: ", message);
    })
  .on('registered', function(message) {
      console.log("registered: ", message);

      client.join("#ripple-watch", function() {
          self.irc  = true;

          console.log("*** Connected to irc");
        });
    });
    
var actionMarket = function (message) {
  if (message)
  {
    console.log("m: " + message);

    if (self.irc) {
      client.action("#ripple-market", message);
    }
  }
}

var actionWatch = function (message) {
  if (message)
  {
    console.log("w: " + message);

    if (self.irc) {
      client.action("#ripple-watch", message);
    }
  }
}

var actionAll = function (message) {
  actionMarket(message);
  actionWatch(message);
}

var writeMarket = function (message) {
  if (message)
  {
    console.log("M: " + message);

    if (self.irc) {
      client.say("#ripple-market", message);
    }
  }
}

var writeWatch = function (message) {
  if (message)
  {
    console.log("W: " + message);

    if (self.irc) {
      client.say("#ripple-watch", message);
    }
  }
}

var process_offers  = function (m) {
  if (m.engine_result === 'tesSUCCESS')
  {
    m.meta.AffectedNodes.forEach(function (n) {
        var type;
        
        if ('ModifiedNode' in n)
          type  = 'ModifiedNode';
        else if ('DeletedNode' in n)
          type  = 'DeletedNode';

        var base  = type ? n[type] : undefined;
        
        if (base && base.LedgerEntryType === 'Offer') {
          var pf  = base.PreviousFields;
          var ff  = base.FinalFields;

          var taker_got   = Amount.from_json(pf.TakerGets).subtract(Amount.from_json(ff.TakerGets));
          var taker_paid  = Amount.from_json(pf.TakerPays).subtract(Amount.from_json(ff.TakerPays));

          if (taker_got.is_native())
          {
            [taker_got, taker_paid] = [taker_paid, taker_got];
          }

          if (taker_paid.is_native())
          {
            var gateway = gateways[taker_got.issuer().to_json({ no_gateway: true })];

            if (gateway)
            {
              writeMarket(
                  gateway
                  + " " + taker_paid.to_human()
                  + " @ " + taker_got.multiply(Amount.from_json("1000000")).divide(taker_paid).to_human()
                  + " " + taker_got.currency().to_human()
                );
            }
            else
            {
              // Ignore unrenowned issuer.
            }
          }
          else
          {
            // Ignore IOU for IOU.
console.log("*: ignore");
//          writeMarket(
//            taker_paid.to_human_full()
//            + " for "
//            + taker_got.to_human_full()
//            );
          }
        }
      });
  }
}

var remote  =
  Remote
    .from_config(remote_config)
    .once('ledger_closed', function (m) {
        self.rippled  = true;

        console.log("*** Connected to rippled");
      })
    .on('error', function (m) {
        console.log("*** rippled error: ", JSON.stringify(m));
      })
    .on('state', function (s) {
        if ('online' === s)
        {
          actionAll("is connected to ripple network. :)");  
        }
        else if ('offline' === s)
        {
          actionAll("is disconnected from ripple network. :(");  
        }
      })
    .on('ledger_closed', function (m) {
        // console.log("ledger: ", JSON.stringify(m));

        remote.request_ledger_header()
          .ledger_index(m.ledger_index)
          .on('error', function (m) {})
          .on('success', function (lh) {
              if (self.totalCoins !== lh.ledger.totalCoins) {
                self.totalCoins = lh.ledger.totalCoins;

                // console.log("ledger_header: ", JSON.stringify(lh));

                actionWatch("on ledger " + m.ledger_index + ". Total: " + Amount.from_json(self.totalCoins).to_human() + "/XRP");
              }
            })
          .request()
      })
    .on('transaction', function (m) {
        var say_watch;

        if (m.transaction.TransactionType === 'Payment')
        {
          // XXX Show tags?
          // XXX Break payments down by parts.

          say_watch = Amount.from_json(m.transaction.Amount).to_human_full()
                  + " "
                  + UInt160.from_json(m.transaction.Account).to_json()
                    + " > "
                    + UInt160.from_json(m.transaction.Destination).to_json();

          process_offers(m);
        }
        else if (m.transaction.TransactionType === 'AccountSet')
        {
          console.log("transaction: ", JSON.stringify(m, undefined, 2));

          say_watch = UInt160.from_json(m.transaction.Account).to_human_full();
        }
        else if (m.transaction.TransactionType === 'TrustSet')
        {
          say_watch = Amount.from_json(m.transaction.LimitAmount).to_human_full()
                        + " "
                        + UInt160.from_json(m.transaction.Account).to_json();
        }
        else if (m.transaction.TransactionType === 'OfferCreate')
        {
          console.log("transaction: ", JSON.stringify(m, undefined, 2));

          say_watch = UInt160.from_json(m.transaction.Account).to_json()
                + " offers " + Amount.from_json(m.transaction.TakerGets).to_human_full()
                + " for " + Amount.from_json(m.transaction.TakerPays).to_human_full();

          process_offers(m);
        }
        else if (m.transaction.TransactionType === 'OfferCancel')
        {
          console.log("transaction: ", JSON.stringify(m, undefined, 2));

          say_watch = m.transaction.Account;
        }

        if (say_watch)
        {
          var output  =
              (m.engine_result === 'tesSUCCESS'
                ? ""
                : m.engine_result + ": ")
              + m.transaction.TransactionType + " "
              + say_watch;

          writeWatch(output);
        }
      })
  .connect();

// vim:sw=2:sts=2:ts=8:et
