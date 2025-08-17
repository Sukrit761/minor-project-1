const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: String,
    email: String,
    username: String,
    password: String,
    age: Number,
    posts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post'  // ✅ Correct model name
    }]
});

module.exports = mongoose.model('User', userSchema);
