console.log("RUNNING NEW CODE");
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// MySQL connection
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "1234",
  database: "canteen"
});

db.connect((err) => {
  if (err) {
    console.log("DB connection error:", err);
  } else {
    console.log("Connected to MySQL");
  }
});


const otpStore = {};


// =========================
// JWT TOKEN GENERATION
// =========================
function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      phone: user.phone,
      is_admin: user.is_admin
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// =========================
// ADMIN AUTH MIDDLEWARE
// =========================
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Access denied"
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Token missing"
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();

  } catch (err) {
    return res.status(403).json({
      success: false,
      message: "Invalid token"
    });
  }
}

// =========================
// ADMIN CHECK MIDDLEWARE
// =========================
function verifyAdmin(req, res, next) {

  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required"
    });
  }

  if (!req.user.is_admin) {
    return res.status(403).json({
      success: false,
      message: "Admin access required"
    });
  }

  next();
}

// =========================
// SIGNUP
// =========================
app.post("/signup", (req, res) => {

  const { name, phone, password, otp } = req.body;

  // validation
  if (!name || !phone || !password || !otp) {
    return res.json({
      success: false,
      message: "All fields are required"
    });
  }

  if (phone.length !== 10) {
    return res.json({
      success: false,
      message: "Phone number must be 10 digits"
    });
  }

  // check existing user
  db.query(
    "SELECT * FROM users WHERE phone = ?",
    [phone],
    async (err, result) => {

      if (err) {
        return res.json({
          success: false,
          message: err.message
        });
      }

      if (result.length > 0) {
        return res.json({
          success: false,
          message: "Phone number already registered"
        });
      }

      // OTP check
      if (otpStore[phone] != otp) {
        return res.json({
          success: false,
          message: "Invalid OTP"
        });
      }

      try {

        // hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // insert user
        db.query(
          "INSERT INTO users (name, phone, password, wallet_balance) VALUES (?, ?, ?, 0)",
          [name, phone, hashedPassword],
          (err, result) => {

            if (err) {
              return res.json({
                success: false,
                message: err.message
              });
            }

            // remove OTP after signup
            delete otpStore[phone];

            res.json({
              success: true,
              message: "Signup successful",
              user_id: result.insertId
            });
          }
        );

      } catch (error) {

        res.json({
          success: false,
          message: "Password hashing failed"
        });

      }

    }
  );

});
// =========================
// SEND OTP (SIMULATED)
// =========================
app.post("/send-otp", (req, res) => {
  const { phone } = req.body;

  const otp = Math.floor(1000 + Math.random() * 9000);

  console.log("OTP for", phone, ":", otp);

  otpStore[phone] = otp; // store OTP

  res.json({ message: "OTP sent" });
});

// =========================
// LOGIN WITH PASSWORD
// =========================
app.post("/login-password", async (req, res) => {
  const { phone, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE phone = ?",
    [phone],
    async (err, result) => {

      if (err) return res.send(err);

      if (result.length === 0) {
        return res.json({
          success: false,
          message: "User not found"
        });
      }

      const user = result[0];

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.json({
          success: false,
          message: "Invalid credentials"
        });
      }

      const token = generateToken(user);

res.json({
  success: true,
  token,
  user
});
    }
  );
});

// =========================
// LOGIN WITH OTP
// =========================
app.post("/login-otp", (req, res) => {
  const { phone, otp } = req.body;

  // 1. Check OTP from memory
  if (otpStore[phone] != otp) {
    return res.json({
      success: false,
      message: "Invalid OTP"
    });
  }

  // 2. Fetch user
  db.query(
    "SELECT * FROM users WHERE phone = ?",
    [phone],
    (err, result) => {
      if (err) return res.send(err);

      if (result.length === 0) {
        return res.json({
          success: false,
          message: "User not found"
        });
      }

      // 3. Clear OTP after use (IMPORTANT)
      delete otpStore[phone];

      const user = result[0];
const token = generateToken(user);

res.json({
  success: true,
  token,
  user
});
    }
  );
});

// =========================
// ADD MONEY
// =========================
app.post("/add-money",verifyToken,verifyAdmin, (req, res) => {
  const { id, amount } = req.body;

  db.query(
    "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
    [amount, id],
    (err, result) => {
      if (err) return res.send(err);

      if (result.affectedRows === 0) {
        return res.json({ message: "User not found" });
      }

      res.json({
        message: "Money added successfully"
      });
    }
  );
});

// =========================
// ORDER
// =========================
app.post("/order", (req, res) => {
  const { user_id, cart, token } = req.body;

  if (!cart || cart.length === 0) {
    return res.json({ success: false, message: "Cart is empty" });
  }

  db.query(
    "SELECT wallet_balance FROM users WHERE id = ?",
    [user_id],
    (err, userResult) => {
      if (err) return res.json({ success: false, message: err.message });

      if (userResult.length === 0) {
        return res.json({ success: false, message: "User not found" });
      }

      let totalCost = 0;

      let checks = cart.map(item => {
        return new Promise((resolve, reject) => {
          db.query(
            "SELECT * FROM products WHERE name = ?",
            [item.name],
            (err, productResult) => {
              if (err) return reject(err.message);

              if (productResult.length === 0) {
                return reject(`Product ${item.item} not found`);
              }

              const product = productResult[0];

              if (product.stock < item.quantity) {
                return reject(`Not enough stock for ${item.item}`);
              }

              totalCost += product.price * item.quantity;

              resolve(product);
            }
          );
        });
      });

      Promise.all(checks)
        .then(products => {

          const balance = userResult[0].wallet_balance;

          if (balance < totalCost) {
            return res.json({ success: false, message: "Insufficient balance" });
          }

          db.query(
            "INSERT INTO orders_new (user_id, token) VALUES (?, ?)",
            [user_id, token],
            (err, orderResult) => {
              if (err) return res.json({ success: false, message: err.message });

              const orderId = orderResult.insertId;

              db.query(
                "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?",
                [totalCost, user_id]
              );

              let promises = [];

              cart.forEach((item, i) => {
                const product = products[i];

                promises.push(new Promise((resolve, reject) => {
                  db.query(
                    "UPDATE products SET stock = stock - ? WHERE id = ?",
                    [item.quantity, product.id],
                    err => err ? reject(err.message) : resolve()
                  );
                }));

                promises.push(new Promise((resolve, reject) => {
                  db.query(
                    "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
                    [orderId, product.id, item.quantity, product.price],
                    err => err ? reject(err.message) : resolve()
                  );
                }));
              });

              Promise.all(promises)
                .then(() => {
                  res.json({
                    success: true,
                    message: "Order placed",
                    token
                  });
                })
                .catch(err => res.json({ success: false, message: err }));
            }
          );
        })
        .catch(err => res.json({ success: false, message: err }));
    }
  );
});

// =========================
// GET USER BY ID (IMPORTANT)
// =========================
app.get("/user/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    "SELECT * FROM users WHERE id = ?",
    [id],
    (err, result) => {
      if (err) return res.send(err);

      if (result.length === 0) {
        return res.send("User not found");
      }

      res.json(result[0]);
    }
  );
});

// =========================
// GET USER ORDERS
// =========================
app.get("/user-orders/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    `SELECT 
        o.id AS order_id,
        o.token,
        o.status,
        o.created_at,
        o.admin_confirmed,
        o.user_confirmed,
        p.name,
        oi.quantity,
        oi.status AS item_status
     FROM orders_new o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     WHERE o.user_id = ?
     ORDER BY o.id DESC`,
    [id],
    (err, result) => {

      if (err) return res.json({ success: false, message: err.message });

      const grouped = {};

      result.forEach(row => {

        if (!grouped[row.token]) {
  grouped[row.token] = {
    order_id: row.order_id,
    items: [],
    time: row.created_at,
    statuses: [],
    status: row.status   // 🔥 THIS FIXES EVERYTHING
  };
}

        // ✅ CLEAN ITEM DISPLAY (NO pending)
        if (row.item_status === "cancelled") {
          grouped[row.token].items.push(
            `${row.name} x${row.quantity} (cancelled)`
          );
        } else {
          grouped[row.token].items.push(
            `${row.name} x${row.quantity}`
          );
        }

        grouped[row.token].statuses.push(row.item_status);
      });

      // ✅ FINAL CLEAN STATUS LOGIC
      Object.keys(grouped).forEach(token => {

        const order = grouped[token];
        const statuses = order.statuses;

        if (order.status === "picked_up") {
  order.final_status = "picked_up";
}
else if (order.status === "timeout") {
  order.final_status = "cancelled";
}
else if (statuses.every(s => s === "cancelled")) {
  order.final_status = "cancelled";
}
else {
  order.final_status = "pending";
}
      });

      res.json(grouped);
    }
  );
});

//token generation
app.get("/generate-token", (req, res) => {
  db.query(
    "SELECT MAX(token) AS maxToken FROM orders_new",
    (err, result) => {
      if (err) return res.json({ success: false, message: err.message });

      const nextToken = (result[0].maxToken || 0) + 1;

      res.json({ token: nextToken });
    }
  );
});

//admin panel stuff

//add product
app.post("/add-product", verifyToken, verifyAdmin, (req, res) => {
  const { name, price, stock } = req.body;

  db.query(
    "INSERT INTO products (name, price, stock) VALUES (?, ?, ?)",
    [name, price, stock],
    (err) => {
      if (err) {
        return res.json({ success: false, message: err.message });
      }

      res.json({ success: true, message: "Product added" });
    }
  );
});

//get products
app.get("/products", (req, res) => {
  db.query("SELECT * FROM products", (err, result) => {
    if (err) return res.json({ success: false, message: err.message });

    res.json(result);
  });
});

//get all products(admin view)
app.get("/admin-orders", (req, res) => {
  db.query(
    `SELECT 
        o.id AS order_id,
        o.token,
        o.created_at,
        o.status AS order_status,
        oi.id AS item_id,           -- 🔥 IMPORTANT (needed for cancel)
        p.name,
        oi.quantity,
        oi.status AS item_status
     FROM orders_new o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     ORDER BY o.id DESC`,
    (err, result) => {
      if (err) return res.json({ success: false, message: err.message });

      res.json(result);
    }
  );
});

//cancel item
app.post("/cancel-item", verifyToken, verifyAdmin, (req, res) => {
    const { item_id } = req.body;

  db.query(
    `SELECT oi.*, o.user_id
     FROM order_items oi
     JOIN orders_new o ON oi.order_id = o.id
     WHERE oi.id = ?`,
    [item_id],
    (err, result) => {

      if (err) return res.json({ success: false, message: err.message });
      if (!result.length) return res.json({ success: false, message: "Item not found" });

      const item = result[0];

      if (item.quantity <= 0) {
        return res.json({ success: false, message: "Nothing to cancel" });
      }

      const cancelQty = 1; // 🔥 always cancel 1 (your requirement)
      const remainingQty = item.quantity - cancelQty;

      const refundAmount = cancelQty * item.price;

      // 🔥 CASE 1: quantity becomes 0 → just mark cancelled
      if (remainingQty === 0) {
        db.query(
          "UPDATE order_items SET status = 'cancelled' WHERE id = ?",
          [item_id],
          (err) => {
            if (err) return res.json({ success: false, message: err.message });

            db.query(
              "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
              [refundAmount, item.user_id],
              () => {
                res.json({ success: true, message: "1 item cancelled & refunded" });
              }
            );
          }
        );
      }

      // 🔥 CASE 2: split row
      else {

        // reduce original row
        db.query(
          "UPDATE order_items SET quantity = ? WHERE id = ?",
          [remainingQty, item_id],
          (err) => {
            if (err) return res.json({ success: false, message: err.message });

            // insert cancelled row
            db.query(
              `INSERT INTO order_items (order_id, product_id, quantity, price, status)
               VALUES (?, ?, ?, ?, 'cancelled')`,
              [item.order_id, item.product_id, cancelQty, item.price],
              (err) => {
                if (err) return res.json({ success: false, message: err.message });

                // refund
                db.query(
                  "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
                  [refundAmount, item.user_id],
                  () => {
                    res.json({ success: true, message: "1 item cancelled & refunded" });
                  }
                );
              }
            );
          }
        );
      }

    }
  );
});

//pickup confirmation
app.post("/admin-pickup", verifyToken, verifyAdmin, (req, res) => {
  const { order_id } = req.body;

  db.query(
    "SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'",
    [order_id],
    (err, items) => {

      if (err) {
        return res.json({
          success: false,
          message: err.message
        });
      }

      // all items cancelled
      if (items.length === 0) {
        return res.json({
          success: false,
          message: "Cannot mark cancelled order as picked up"
        });
      }

      // valid pickup
      db.query(
        "UPDATE orders_new SET status = 'picked_up' WHERE id = ?",
        [order_id],
        (err) => {

          if (err) {
            return res.json({
              success: false,
              message: err.message
            });
          }

          res.json({
            success: true,
            message: "Order marked as picked up"
          });
        }
      );

    }
  );
});

//user pickup confirmation
app.post("/user-pickup",verifyToken, verifyAdmin, (req, res) => {
  const { order_id } = req.body;

  db.query(
    "UPDATE orders_new SET user_confirmed = 1 WHERE id = ?",
    [order_id],
    (err) => {
      if (err) return res.json({ success: false, message: err.message });

      db.query(
        "SELECT admin_confirmed, user_confirmed FROM orders_new WHERE id = ?",
        [order_id],
        (err, result) => {

          const order = result[0];

          if (order.admin_confirmed && order.user_confirmed) {
            db.query(
              "UPDATE orders_new SET status = 'picked_up' WHERE id = ?",
              [order_id]
            );
          }

          res.json({ success: true, message: "Marked as received" });
        }
      );
    }
  );
});

// ================= UPDATE STOCK =================
app.post("/update-stock", verifyToken, verifyAdmin, (req, res) => {
    const { id, stock } = req.body;

  db.query(
    "UPDATE products SET stock = ? WHERE id = ?",
    [stock, id],
    (err) => {
      if (err) return res.json({ success: false, message: err.message });

      res.json({ success: true, message: "Stock updated" });
    }
  );
});

// =========================
// GET USER BY PHONE
// =========================
app.get("/find-user-by-phone/:phone", (req, res) => {
  const { phone } = req.params;

  db.query(
    "SELECT id, name, phone FROM users WHERE phone = ?",
    [phone],
    (err, result) => {
      if (err) {
        return res.json({
          success: false,
          message: err.message
        });
      }

      if (result.length === 0) {
        return res.json({
          success: false,
          message: "User not found"
        });
      }

      res.json({
        success: true,
        user: result[0]
      });
    }
  );
});





// =========================
// TIMEOUT WORKER (runs every 1 min)
// =========================
setInterval(() => {

  // find pending orders older than 20 minutes
  db.query(
    `SELECT id FROM orders_new 
     WHERE status = 'pending' 
     AND created_at < NOW() - INTERVAL 20 MINUTE`,
    (err, orders) => {
      if (err) {
        console.log("Timeout check error:", err);
        return;
      }

      if (!orders.length) return;

      orders.forEach(order => {
        const orderId = order.id;

        // 1) mark order as timeout
        db.query(
          "UPDATE orders_new SET status = 'timeout' WHERE id = ?",
          [orderId],
          (err) => {
            if (err) console.log("Timeout update error:", err);
          }
        );

        // 2) get items to return stock (ONLY non-cancelled items)
        db.query(
          `SELECT oi.product_id, oi.quantity 
           FROM order_items oi
           WHERE oi.order_id = ? AND oi.status != 'cancelled'`,
          [orderId],
          (err, items) => {
            if (err) {
              console.log("Timeout items error:", err);
              return;
            }

            items.forEach(item => {
              db.query(
                "UPDATE products SET stock = stock + ? WHERE id = ?",
                [item.quantity, item.product_id]
              );
            });
          }
        );
      });
    }
  );

}, 60000); // runs every 60 seconds


// =========================
// START SERVER
// =========================
app.listen(3000, () => {
  console.log("Server started on port 3000");
});